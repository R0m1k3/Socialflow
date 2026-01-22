FROM python:3.11-slim

# Install system dependencies including FFmpeg and fonts
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Create API Key env var (should be overridden in docker-compose)
ENV API_KEY=default-dev-key

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
