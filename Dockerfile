FROM node:20-alpine

# Install claude CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# State directory
RUN mkdir -p /root/.claude-session-keeper

CMD ["node", "bin/claude-session-keeper.js", "start"]
