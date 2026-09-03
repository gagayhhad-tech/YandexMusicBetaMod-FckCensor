FROM node:20-bullseye

RUN apt-get update && apt-get install -y \
    dpkg \
    fakeroot \
    rpm \
    libnss3 \
    libgtk-3-0 \
    libgbm-dev \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

RUN npm install -g electron-builder asar

# Default command to build the app
CMD ["/bin/bash", "-c", "echo 'Extracting app.asar...' && asar extract app.asar app && echo 'Removing windows dependencies...' && rm -f app/assets/ffmpeg.exe && echo 'Building Linux packages...' && electron-builder --linux --x64"]
