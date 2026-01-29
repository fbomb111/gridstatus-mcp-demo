FROM python:3.12-slim

WORKDIR /app

# Install system deps for gridstatus (pandas, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ tzdata && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8000
EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
