# Poultry Disease Prediction API — Deployment Guide

This guide walks you through hosting the FastAPI model server so your HealthTriageModule can call it from the frontend.

## Quick Architecture

```
Your Frontend (React)
    ↓
    └─→ Disease Prediction API (FastAPI, this deployment)
        ├─ Loads 3 ML models at startup
        ├─ POST /predict endpoint (symptoms + 2 images → disease)
        └─ GET /symptoms endpoint (returns available symptoms for UI)
```

## Option 1: Deploy to Render.com (Recommended for fast setup)

### Step 1: Prepare your repo

```bash
# In a new folder, create this structure:
model-api/
├── app.py
├── requirements.txt
├── Dockerfile
└── models/
    ├── poultry_disease_model.pkl
    ├── poultry_disease_model_final22.keras
    ├── poultry_disease_model_final33.keras
    ├── symptom_list.pkl
    ├── disease_label_encoder.pkl
    ├── feature_names.pkl
    ├── species_encoder.pkl
    ├── model_metadata.json
    ├── class_names.txt
    └── droppings_class_names.txt
```

### Step 2: Create a `.gitignore`

```
__pycache__/
*.pyc
.env
.DS_Store
```

### Step 3: Initialize git and push to GitHub

```bash
cd model-api
git init
git add .
git commit -m "Initial commit: poultry disease prediction API"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/model-api.git
git push -u origin main
```

### Step 4: Deploy to Render

1. Go to **https://render.com**
2. Sign up or log in
3. Click **"New +"** → **"Web Service"**
4. Connect your GitHub repo (`model-api`)
5. Fill in:
   - **Name:** `poultry-disease-api`
   - **Environment:** Docker
   - **Region:** Choose closest to Kenya (or default)
   - **Plan:** Free tier ($0/month, but slower; upgrade to Paid later if needed)
6. Click **Deploy**

Render will build and deploy in ~5 minutes. You'll get a URL like:
```
https://poultry-disease-api.onrender.com
```

### Step 5: Test the API

```bash
# Get available symptoms
curl https://poultry-disease-api.onrender.com/symptoms

# Health check
curl https://poultry-disease-api.onrender.com/health

# Test prediction (with symptoms only)
curl -X POST https://poultry-disease-api.onrender.com/predict \
  -H "Content-Type: application/json" \
  -d '{
    "symptoms": ["coughing", "sneezing"],
    "species": "chicken"
  }'
```

---

## Option 2: Deploy to Railway.app

### Step 1: Create a Railway account and project

1. Go to **https://railway.app**
2. Create an account
3. Create a new project → **Deploy from GitHub**
4. Connect your GitHub repo and authorize

### Step 2: Add environment variables (optional)

In Railway dashboard, under **Variables**:
```
MODEL_DIR = ./models
```

### Step 3: Deploy

Railway auto-detects `Dockerfile` and deploys. You'll get a public URL.

---

## Option 3: Self-hosted on a VPS (DigitalOcean, Linode, AWS EC2)

### Step 1: SSH into your server

```bash
ssh root@your_server_ip
```

### Step 2: Install Docker

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

### Step 3: Clone your repo

```bash
git clone https://github.com/YOUR_USERNAME/model-api.git
cd model-api
```

### Step 4: Build and run

```bash
docker build -t poultry-disease-api .
docker run -d -p 8000:8000 --name disease-api poultry-disease-api
```

### Step 5: Access via your server's IP

```
http://your_server_ip:8000
```

(Optionally, add a reverse proxy like Nginx + SSL for production)

---

## Integration with Frontend

### Step 1: Set the API URL in your `.env.local`

In your React project root:

```
REACT_APP_DISEASE_API_URL=https://poultry-disease-api.onrender.com
```

(For development, use `http://localhost:8000`)

### Step 2: Use the `useDiseasePrediction` hook in HealthTriageModule

```typescript
import { useDiseasePrediction, fileToBase64 } from "@/hooks/useDiseasePrediction";
import { useState } from "react";

export function HealthTriageModule({ profile }) {
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [chickenImage, setChickenImage] = useState<File | null>(null);
  const [droppingsImage, setDroppingsImage] = useState<File | null>(null);

  const { predict, loading, error, result } = useDiseasePrediction();

  const handlePredict = async () => {
    try {
      let chickenBase64: string | undefined;
      let droppingsBase64: string | undefined;

      if (chickenImage) chickenBase64 = await fileToBase64(chickenImage);
      if (droppingsImage) droppingsBase64 = await fileToBase64(droppingsImage);

      const prediction = await predict(
        selectedSymptoms,
        chickenBase64,
        droppingsBase64,
        profile.poultryTypes[0] || "chicken"
      );

      console.log("Prediction:", prediction);
      // Display prediction in UI...
    } catch (err) {
      console.error("Prediction failed:", err);
      // Show fallback or error message
    }
  };

  return (
    <div>
      {/* Symptom picker (up to 10) */}
      <SymptomMultiselect
        maxSelections={10}
        onSelect={setSelectedSymptoms}
      />

      {/* Image upload for chicken */}
      <ImageUpload
        label="Upload chicken photo"
        onUpload={setChickenImage}
      />

      {/* Image upload for droppings */}
      <ImageUpload
        label="Upload droppings photo"
        onUpload={setDroppingsImage}
      />

      {/* Predict button */}
      <button onClick={handlePredict} disabled={loading}>
        {loading ? "Analyzing..." : "Predict Disease"}
      </button>

      {/* Show results or error */}
      {error && <div className="error">{error}</div>}
      {result && (
        <div className="result">
          <h3>{result.disease}</h3>
          <p>Confidence: {(result.confidence * 100).toFixed(1)}%</p>
          <p>Models used: {result.model_sources.join(", ")}</p>
          {result.warnings.length > 0 && (
            <div className="warnings">
              {result.warnings.map((w) => <p key={w}>{w}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 3: Add `.env.local` to `.gitignore`

Make sure you never commit API URLs with real secrets:

```bash
echo "REACT_APP_DISEASE_API_URL=..." >> .env.local
echo ".env.local" >> .gitignore
git add .gitignore
git commit -m "Ignore .env.local"
```

---

## Monitoring & Troubleshooting

### Check API logs

**Render:**
- Dashboard → Your service → **Logs**

**Railway:**
- Dashboard → Project → **Logs**

**Self-hosted:**
```bash
docker logs disease-api
```

### Common issues

**"Connection refused"**
- API not running; check logs
- Firewall blocking port 8000
- Wrong URL in `.env.local`

**"Models not loaded"**
- Model files missing from `models/` folder
- Wrong file format or corrupted pickle file
- TensorFlow/XGBoost version mismatch

**Slow predictions**
- Free tier Render instance is slow; upgrade to paid
- Large images taking time to process; consider resizing
- Model ensemble running 3 models in series; can parallelize if needed

**CORS errors**
- Ensure `CORSMiddleware` is enabled in `app.py` (it is by default)
- For production, restrict `allow_origins` to your domain only

---

## Cost Summary

- **Render Free:** $0/month (may sleep after 15 min inactivity)
- **Render Paid (Standard):** $7/month (always running)
- **Railway:** Free tier available, paid tiers from $5+/month
- **Self-hosted VPS:** $4–20/month depending on provider

For a hobby/MVP app, Render Free is fine. For production with real usage, upgrade to Paid.

---

## Next Steps

1. Deploy the API using one of the options above
2. Integrate the `useDiseasePrediction` hook into `HealthTriageModule`
3. Test end-to-end: select symptoms → upload images → get prediction
4. Set up fallback logic for when API is down (use symptoms-only heuristic)
5. Monitor API logs for errors and refine models as needed
