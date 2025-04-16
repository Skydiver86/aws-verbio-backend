# Verwenden Sie das Node.js-Basisimage mit der neuesten LTS-Version
FROM node:18

# Setzen Sie das Arbeitsverzeichnis
WORKDIR /app

# Kopieren Sie die package.json und package-lock.json
COPY package*.json ./

# Installieren Sie die Abhängigkeiten
RUN npm install

# Kopieren Sie den Rest des Codes
COPY . .

# Exponieren Sie den Port, auf dem Ihre Anwendung läuft (z.B. 3000)
EXPOSE 3000

# Starten Sie die Anwendung
CMD ["node", "server.js"]
