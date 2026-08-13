# PoultryFit Disease Prediction System — Architecture

## Overview

The disease prediction system is a **separate microservice** that your PoultryFit frontend calls via API. It's decoupled from your main backend (Supabase + Lovable) by design, so you can:

- Upgrade/retrain models without touching the main app
- Scale prediction independently (busy time → add more API instances)
- Handle model downtime gracefully (fallback to symptoms-only heuristic)
- Share predictions with other users/apps via public API

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     PoultryFit Frontend (React)                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ HealthTriageModule                                         │ │
│  │ ├─ Symptom multi-select (up to 10)                        │ │
│  │ ├─ Camera capture: chicken photo                          │ │
│  │ ├─ Camera capture: droppings photo                        │ │
│  │ └─ [Predict Disease] button                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ↓ (fetch)                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ useDiseasePrediction hook                                  │ │
│  │ ├─ Converts images to base64                              │ │
│  │ ├─ Calls POST /predict                                    │ │
│  │ ├─ Shows loading spinner                                  │ │
│  │ └─ Handles timeout/error fallback                         │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │ (HTTPS)
                             ↓
┌────────────────────────────────────────────────────────────────┐
│          Disease Prediction API (FastAPI Microservice)         │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Endpoints                                                  ││
│  │ ├─ GET  /health            → {"status": "ok"}            ││
│  │ ├─ GET  /symptoms          → {symptoms: [...], ...}      ││
│  │ └─ POST /predict           → {disease: "...", ...}       ││
│  └────────────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Models (loaded at startup)                                 ││
│  │ ├─ poultry_disease_model.pkl      (XGBoost, symptoms)    ││
│  │ ├─ poultry_disease_model_final22  (Keras CNN, chicken)   ││
│  │ └─ poultry_disease_model_final33  (Keras CNN, droppings) ││
│  └────────────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Ensemble Logic                                             ││
│  │ 1. Symptoms → XGBoost → probabilities (50% weight)        ││
│  │ 2. Chicken image → Keras → probabilities (30% weight)     ││
│  │ 3. Droppings image → Keras → probabilities (20% weight)   ││
│  │ 4. Weighted average + argmax → top disease               ││
│  └────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

## Data Flow

### User Journey

1. **Farmer opens HealthTriageModule** in dashboard
2. **UI fetches symptom list** via `GET /symptoms`
3. **Farmer selects symptoms** (multiselect, max 10)
4. **Farmer captures/uploads 2 images** (chicken + droppings)
5. **Clicks "Predict Disease"**
6. **Frontend converts images to base64 and calls `POST /predict`**
7. **API loads 3 models and runs inference in parallel**
8. **Ensemble combines results (weighted average)**
9. **API returns disease name + confidence + model sources**
10. **Frontend displays result** or **fallback if API timed out**

### Fallback Logic (Server Down)

If `POST /predict` times out (>30s) or returns 500:

```typescript
// useDiseasePrediction hook catches error and:
1. Show banner: "Model server unavailable. Using offline prediction."
2. Call local triage() function with selected symptoms only
3. Display symptoms-based heuristic result
4. Suggest farmer consult veterinarian for confirmation
```

## Model Details

### 1. Symptoms Model (XGBoost)

- **Input:** Binary vector, 49 features (one per symptom)
  - `[blindness=1, bloody_diarrhea=0, breathing_difficulty=1, ...]`
- **Output:** Probability distribution over 12 diseases
  - `[Avian_Influenza=0.02, Coccidiosis=0.85, ..., Newcastle=0.01]`
- **Latency:** ~50ms on CPU
- **Weight in ensemble:** 50% (most reliable)

### 2. Chicken Image Model (Keras CNN)

- **Input:** 224×224 RGB image (resized + normalized to [0, 1])
- **Output:** Probability over chicken health classes
  - `[Healthy=0.1, Coccidiosis=0.7, Newcastle=0.15, ...]`
- **Latency:** ~200ms on CPU
- **Weight in ensemble:** 30%

### 3. Droppings Image Model (Keras CNN)

- **Input:** 224×224 RGB image (droppings photo)
- **Output:** Probability over droppings condition classes
  - `[Healthy=0.2, Abnormal=0.8, ...]`
- **Latency:** ~200ms on CPU
- **Weight in ensemble:** 20%

### Ensemble Weights

Why these weights?

- **Symptoms 50%:** Farmer directly reports what they observe; high signal
- **Chicken image 30%:** Visual signs of illness are specific
- **Droppings image 20%:** Useful but less specific; could be artifacts or lighting

Weights can be tuned based on validation accuracy per model.

---

## Deployment Topology

### Development (Local Testing)

```
Frontend (http://localhost:5173)
  ↓
API (http://localhost:8000)
  ↓
Models (./models/)
```

Run API locally:
```bash
python -m uvicorn app:app --reload
```

Set in `.env.local`:
```
REACT_APP_DISEASE_API_URL=http://localhost:8000
```

### Production

```
Frontend (https://poultryfit.app)
  ↓
API (https://poultry-disease-api.onrender.com)
  ↓
Models (mounted in Docker container)
```

See `DEPLOYMENT.md` for how to deploy.

---

## Integration Checklist

- [ ] Copy `app.py`, `requirements.txt`, `Dockerfile`, all model files to a new repo
- [ ] Deploy to Render/Railway/self-hosted using `DEPLOYMENT.md`
- [ ] Get the public API URL (e.g., `https://poultry-disease-api.onrender.com`)
- [ ] Add `useDiseasePrediction.ts` hook to your frontend project
- [ ] Integrate hook into `HealthTriageModule` (see example in `useDiseasePrediction.ts`)
- [ ] Set `REACT_APP_DISEASE_API_URL` in `.env.local`
- [ ] Test end-to-end locally
- [ ] Update `.gitignore` to exclude `.env.local`
- [ ] Commit and push frontend changes

---

## API Contract

### `GET /health`

```
Request:
  GET https://poultry-disease-api.onrender.com/health

Response (200 OK):
  { "status": "ok" }
```

### `GET /symptoms`

Returns all available symptoms and diseases for the UI to display.

```
Request:
  GET https://poultry-disease-api.onrender.com/symptoms

Response (200 OK):
  {
    "symptoms": [
      "blindness",
      "bloody diarrhea",
      "breathing difficulty",
      ...
    ],
    "diseases": [
      "Avian Influenza",
      "Coccidiosis",
      "Fowl Cholera",
      ...
    ],
    "species": ["chicken", "duck", "quail", "turkey"]
  }
```

### `POST /predict`

Main prediction endpoint. Takes symptoms and/or images and returns a disease prediction.

```
Request:
  POST https://poultry-disease-api.onrender.com/predict
  Content-Type: application/json
  
  {
    "symptoms": ["coughing", "sneezing", "nasal discharge"],
    "chicken_image_base64": "iVBORw0KGgoAAAANS...",  // optional
    "droppings_image_base64": "iVBORw0KGgoAAAANS...", // optional
    "species": "chicken"
  }

Response (200 OK):
  {
    "disease": "Newcastle Disease",
    "confidence": 0.89,
    "symptoms_matched": ["coughing", "sneezing", "nasal discharge"],
    "model_sources": ["symptoms", "chicken_image"],
    "warnings": []
  }

Response (400 Bad Request):
  {
    "detail": "At least one of (symptoms, chicken_image, droppings_image) is required"
  }

Response (503 Service Unavailable):
  {
    "detail": "Models not loaded"
  }
```

---

## Monitoring & Maintenance

### What to monitor

1. **API uptime** — Use Render's monitoring or external tool (Uptime Robot)
2. **Prediction latency** — Should be <5s for 90th percentile
3. **Error rate** — Track API 5xx errors in logs
4. **Model drift** — Periodically retrain on new farmer data

### Logs

Check API logs for:
- Model loading failures (startup)
- Image preprocessing errors
- Model inference timeouts
- CORS issues

### Retraining

When to retrain models:

- Once you have 100+ real farmer predictions with confirmed diagnoses
- If accuracy drops below 75% on validation set
- Yearly review of livestock disease landscape

Process:

1. Export confirmed predictions from Supabase (`disease_predictions` table)
2. Retrain models with team's ML person
3. Upload new `.pkl` and `.keras` files
4. Restart API (Render: redeploy; self-hosted: `docker restart`)

---

## Costs & Scaling

### Free tier (Render)

- $0/month
- 100MB RAM
- Model loads in ~30s
- May sleep after 15 min inactivity → slow first request
- Good for MVP/testing

### Paid tier (Render Standard)

- $7/month
- 512MB RAM
- Always running
- Faster model load + predictions
- Good for pilot or small deployment

### Self-hosted (DigitalOcean $5 droplet)

- $5–6/month
- Full control
- Need to manage updates/SSL
- Good for long-term if high traffic

### Scaling (if needed later)

- Render: upgrade plan
- Self-hosted: add load balancer + multiple API instances

---

## Security Notes

- API has no authentication by default (public endpoint)
- For production with private farm data, add API key validation
- Use HTTPS (Render auto-provides; self-hosted: add Nginx + Let's Encrypt)
- Do NOT commit API keys or model files to public GitHub

---

## What's Next

1. **Deploy the API** (DEPLOYMENT.md)
2. **Integrate with HealthTriageModule** (see useDiseasePrediction.ts example)
3. **Test end-to-end** with real symptoms + images
4. **Monitor logs** for errors
5. **Collect farmer feedback** and retrain models periodically

Questions? Check logs and DEPLOYMENT.md troubleshooting section.
