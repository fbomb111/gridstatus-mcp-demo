FROM python:3.12-slim

WORKDIR /app

# Install system deps for gridstatus (pandas, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ tzdata && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
ENV PORT=8000
EXPOSE 8000

RUN useradd -r -s /usr/sbin/nologin appuser
USER appuser
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
