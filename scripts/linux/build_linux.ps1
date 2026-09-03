Write-Host "Building Docker image for electron-builder..."
docker build -t ymliberty-builder .

Write-Host "Running build inside Docker container..."
docker run --rm -v "${PWD}:/workspace" ymliberty-builder

Write-Host "Build complete! Check the 'dist' folder."
