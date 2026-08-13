"""
Poultry Disease Prediction API
Ensemble of XGBoost (symptoms) + Keras CNN (chicken image) + Keras CNN (droppings)
"""

import os
import base64
import json
import pickle
from io import BytesIO
from typing import List, Optional

import numpy as np
import tensorflow as tf
import joblib
from PIL import Image
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============================================================================
# CONFIGURATION
# ============================================================================

# Adjust these paths if deployed elsewhere
MODEL_DIR = os.getenv("MODEL_DIR", "./models")
SYMPTOMS_MODEL_PATH = os.path.join(MODEL_DIR, "poultry_disease_model.pkl")
CHICKEN_IMAGE_MODEL_PATH = os.path.join(MODEL_DIR, "poultry_disease_model_final22.keras")
DROPPINGS_IMAGE_MODEL_PATH = os.path.join(MODEL_DIR, "poultry_disease_model_final33.keras")
SYMPTOM_LIST_PATH = os.path.join(MODEL_DIR, "symptom_list.pkl")
DISEASE_ENCODER_PATH = os.path.join(MODEL_DIR, "disease_label_encoder.pkl")
FEATURE_NAMES_PATH = os.path.join(MODEL_DIR, "feature_names.pkl")
SPECIES_ENCODER_PATH = os.path.join(MODEL_DIR, "species_encoder.pkl")
METADATA_PATH = os.path.join(MODEL_DIR, "model_metadata.json")

IMAGE_SIZE = (224, 224)  # Standard for Keras CNN

# If set, /predict requires "Authorization: Bearer <API_KEY>". Leave unset locally.
API_KEY = os.getenv("API_KEY")

# ============================================================================
# MODELS & DATA (loaded at startup)
# ============================================================================

app = FastAPI(title="Poultry Disease Predictor", version="1.0")

# Add CORS so frontend can call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model containers
models = {
    "symptoms_model": None,
    "chicken_image_model": None,
    "droppings_image_model": None,
    "symptom_list": None,
    "feature_names": None,
    "metadata": None,
    "species_encoder": None,
}


@app.on_event("startup")
def load_models():
    """Load all models at startup."""
    global models
    try:
        print("Loading models...")
        
        # Load metadata first (it has disease/symptom definitions)
        with open(METADATA_PATH, "r") as f:
            models["metadata"] = json.load(f)
        
        # Load symptom list for the UI
        with open(SYMPTOM_LIST_PATH, "rb") as f:
            models["symptom_list"] = pickle.load(f)
        
        # Load feature names for XGBoost input ordering
        with open(FEATURE_NAMES_PATH, "rb") as f:
            models["feature_names"] = pickle.load(f)

        # Load species encoder (turns "chicken"/"duck"/"quail"/"turkey" into the
        # numeric value the "species" feature expects)
        models["species_encoder"] = joblib.load(SPECIES_ENCODER_PATH)

        # Load XGBoost symptoms model (pickled object)
        with open(SYMPTOMS_MODEL_PATH, "rb") as f:
            models["symptoms_model"] = pickle.load(f)
        
        # Load Keras image models
        models["chicken_image_model"] = tf.keras.models.load_model(CHICKEN_IMAGE_MODEL_PATH)
        models["droppings_image_model"] = tf.keras.models.load_model(DROPPINGS_IMAGE_MODEL_PATH)
        
        print("✓ All models loaded successfully")
    except Exception as e:
        print(f"✗ Error loading models: {e}")
        raise


# ============================================================================
# REQUEST/RESPONSE SCHEMAS
# ============================================================================

class PredictionRequest(BaseModel):
    symptoms: Optional[List[str]] = None  # Symptom names from the UI
    chicken_image_base64: Optional[str] = None  # Base64-encoded image
    droppings_image_base64: Optional[str] = None  # Base64-encoded image
    species: str = "chicken"  # Which bird type


class PredictionResult(BaseModel):
    disease: str
    confidence: float
    symptoms_matched: List[str]
    model_sources: List[str]  # Which models contributed (symptoms, chicken_image, droppings_image)
    warnings: List[str] = []


class SymptomListResponse(BaseModel):
    symptoms: List[str]
    diseases: List[str]
    species: List[str]


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def preprocess_image(image_base64: str) -> np.ndarray:
    """Decode base64 image and resize to model input size."""
    try:
        image_data = base64.b64decode(image_base64)
        image = Image.open(BytesIO(image_data)).convert("RGB")
        image = image.resize(IMAGE_SIZE)
        image_array = np.array(image) / 255.0  # Normalize to [0, 1]
        return np.expand_dims(image_array, axis=0)  # Add batch dimension
    except Exception as e:
        raise ValueError(f"Failed to process image: {e}")


def prepare_symptoms_input(symptoms: List[str], species: str) -> np.ndarray:
    """
    Convert symptom names + species to a feature vector for XGBoost.
    Order matches the model's feature_names. Symptom columns are binary;
    the "species" column is label-encoded via species_encoder.pkl.
    """
    feature_names = models["feature_names"]
    feature_vector = np.zeros(len(feature_names))
    encoder = models["species_encoder"]

    for i, feature in enumerate(feature_names):
        if feature == "species":
            try:
                feature_vector[i] = encoder.transform([species])[0]
            except ValueError:
                # Unknown species to the model (e.g. goose, guinea-fowl aren't
                # in its training data) — fall back to "chicken" rather than 0.
                feature_vector[i] = encoder.transform(["chicken"])[0]
        elif feature in symptoms:
            feature_vector[i] = 1

    return np.expand_dims(feature_vector, axis=0)  # Add batch dimension


def ensemble_predict(symptom_proba, chicken_proba, droppings_proba):
    """
    Combine predictions from all three models using weighted averaging.
    Weights can be tuned based on model accuracy.
    """
    weights = {
        "symptoms": 0.5,  # Symptoms model is most reliable
        "chicken_image": 0.3,
        "droppings_image": 0.2,
    }
    
    combined = np.zeros_like(symptom_proba) if symptom_proba is not None else None
    sources = []
    
    if symptom_proba is not None:
        if combined is None:
            combined = np.zeros_like(symptom_proba)
        combined += weights["symptoms"] * symptom_proba
        sources.append("symptoms")
    if chicken_proba is not None:
        if combined is None:
            combined = np.zeros_like(chicken_proba)
        combined += weights["chicken_image"] * chicken_proba
        sources.append("chicken_image")
    if droppings_proba is not None:
        if combined is None:
            combined = np.zeros_like(droppings_proba)
        combined += weights["droppings_image"] * droppings_proba
        sources.append("droppings_image")
    
    # Renormalize
    if combined is not None and len(sources) > 0:
        combined = combined / sum([weights[s] for s in sources])
    
    return combined, sources


# ============================================================================
# ENDPOINTS
# ============================================================================

@app.get("/health")
def health_check():
    """Simple health check."""
    return {"status": "ok"}


@app.get("/symptoms", response_model=SymptomListResponse)
def get_symptom_list():
    """Return the list of all symptoms and diseases for the UI to use."""
    if not models["metadata"]:
        raise HTTPException(status_code=503, detail="Models not loaded")
    
    return SymptomListResponse(
        symptoms=models["metadata"].get("feature_order", [])[:-1],  # Exclude 'species'
        diseases=models["metadata"].get("diseases", []),
        species=models["metadata"].get("species", []),
    )


def check_api_key(authorization: Optional[str]) -> None:
    if not API_KEY:
        return  # no key configured, e.g. local dev
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.post("/predict", response_model=PredictionResult)
def predict(request: PredictionRequest, authorization: Optional[str] = Header(default=None)):
    """
    Make a disease prediction based on symptoms and/or images.
    
    At least one of (symptoms, chicken_image, droppings_image) must be provided.
    """
    check_api_key(authorization)
    if not models["metadata"]:
        raise HTTPException(status_code=503, detail="Models not loaded")
    
    if not request.symptoms and not request.chicken_image_base64 and not request.droppings_image_base64:
        raise HTTPException(
            status_code=400,
            detail="At least one of (symptoms, chicken_image, droppings_image) is required",
        )
    
    symptom_proba = None
    chicken_proba = None
    droppings_proba = None
    warnings = []
    
    # ────────────────────────────────────────────────────────────────────
    # Symptoms-based prediction
    # ────────────────────────────────────────────────────────────────────
    if request.symptoms:
        try:
            X = prepare_symptoms_input(request.symptoms, request.species)
            symptom_proba = models["symptoms_model"].predict_proba(X)[0]
        except Exception as e:
            warnings.append(f"Symptoms model failed: {e}")
    
    # ────────────────────────────────────────────────────────────────────
    # Chicken image prediction
    # ────────────────────────────────────────────────────────────────────
    if request.chicken_image_base64:
        try:
            X = preprocess_image(request.chicken_image_base64)
            chicken_proba = models["chicken_image_model"].predict(X, verbose=0)[0]
        except Exception as e:
            warnings.append(f"Chicken image model failed: {e}")
    
    # ────────────────────────────────────────────────────────────────────
    # Droppings image prediction
    # ────────────────────────────────────────────────────────────────────
    if request.droppings_image_base64:
        try:
            X = preprocess_image(request.droppings_image_base64)
            droppings_proba = models["droppings_image_model"].predict(X, verbose=0)[0]
        except Exception as e:
            warnings.append(f"Droppings image model failed: {e}")
    
    # ────────────────────────────────────────────────────────────────────
    # Ensemble & decode result
    # ────────────────────────────────────────────────────────────────────
    if symptom_proba is None and chicken_proba is None and droppings_proba is None:
        raise HTTPException(status_code=500, detail="All models failed")
    
    combined_proba, sources = ensemble_predict(symptom_proba, chicken_proba, droppings_proba)
    
    # Get top disease
    predicted_idx = np.argmax(combined_proba)
    confidence = float(combined_proba[predicted_idx])
    disease = models["metadata"]["diseases"][predicted_idx]
    
    # Match symptoms to the disease (simple heuristic: show input symptoms)
    symptoms_matched = request.symptoms if request.symptoms else []
    
    if warnings and confidence < 0.6:
        warnings.append(
            "Low confidence prediction. Please consult a veterinarian for confirmation."
        )
    
    return PredictionResult(
        disease=disease,
        confidence=confidence,
        symptoms_matched=symptoms_matched,
        model_sources=sources,
        warnings=warnings,
    )


# ============================================================================
# RUN SERVER
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)