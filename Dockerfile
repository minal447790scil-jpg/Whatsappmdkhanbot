
FROM node:22-bookworm

# Install system dependencies
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
ENV DENO_INSTALL=/root/.deno
ENV PATH="/root/.deno/bin:${PATH}"

RUN curl -fsSL https://deno.land/install.sh | sh \
    && ln -sf /root/.deno/bin/deno /usr/local/bin/deno

# Create Python virtual environment and install yt-dlp + curl-cffi
RUN python3 -m venv /opt/instagram-venv \
    && /opt/instagram-venv/bin/python -m pip install --upgrade pip setuptools wheel \
    && /opt/instagram-venv/bin/python -m pip install --upgrade "yt-dlp[default,curl-cffi]"

# Make the virtual environment's Python available
ENV PATH="/opt/instagram-venv/bin:${PATH}"

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

CMD ["npm", "start"]
