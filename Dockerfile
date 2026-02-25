# Use official Node.js image as base
FROM node:20-alpine

# Install SSH client tools in the container so it can connect to the host
RUN apk add --no-cache openssh-client

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
# Note: In a real environment, we'd build the frontend first. 
# For this setup, we'll install concurrently and run both.
COPY backend/package*.json ./backend/
RUN cd backend && npm install

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

# Copy source code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Build frontend
RUN cd frontend && npm run build

# We will serve the frontend from the Express backend in production
# Let's modify the backend later to serve the static frontend files
# For now, we will just start the backend server
WORKDIR /app/backend

EXPOSE 3001

CMD ["node", "server.js"]
