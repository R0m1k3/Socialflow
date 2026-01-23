FROM python:3.11-slim

# Install system dependencies including FFmpeg with vidstab support and fonts
# We need to build/install libvidstab and compile ffmpeg with it, OR use static build
RUN apt-get update && apt-get install -y \
    wget \
    xz-utils \
    fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

# Download static FFmpeg build with all filters including vidstab
RUN wget -q https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    && tar xf ffmpeg-release-amd64-static.tar.xz \
    && mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ \
    && mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ \
    && rm -rf ffmpeg-*

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
