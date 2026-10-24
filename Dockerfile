# One image for every host: Hugging Face Space now, a Vultr VM later.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
    && rm -rf /var/lib/apt/lists/*
# Hugging Face Spaces run as uid 1000.
RUN useradd -m -u 1000 app
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY playbooks/ ./playbooks/
COPY --from=web /web/dist ./static
USER app
ENV HOME=/home/app PYTHONUNBUFFERED=1
EXPOSE 7860
# Binds all interfaces inside the container; the host decides what is published.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers"]
