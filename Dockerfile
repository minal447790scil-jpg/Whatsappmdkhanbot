
FROM node:20-bookworm

# System dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Deno
RUN curl -fsSL https://deno.land/install.sh | sh \
    && ln -s /root/.deno/bin/deno /usr/local/bin/deno

# Python virtual environment
RUN python3 -m venv /opt/instagram-venv

# Install parth-dl
RUN /opt/instagram-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/instagram-venv/bin/pip install --no-cache-dir "parth-dl==1.2.1"

# Environment
ENV PATH="/opt/instagram-venv/bin:/root/.deno/bin:${PATH}"
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy bot files
COPY . .

CMD ["npm", "start"]
