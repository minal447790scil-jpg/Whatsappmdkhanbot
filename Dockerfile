
FROM node:22-bookworm

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

# Install Instagram downloader
RUN /opt/instagram-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/instagram-venv/bin/pip install --no-cache-dir parth-dl

# Make Python downloader available
ENV PATH="/opt/instagram-venv/bin:/root/.deno/bin:${PATH}"

# Application directory
WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Start bot
CMD ["npm", "start"]
