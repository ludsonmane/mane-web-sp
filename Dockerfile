FROM node:20-alpine
RUN npm i -g serve@14
WORKDIR /app
COPY index.html ./
ENV PORT=3000
EXPOSE 3000
CMD sh -c "serve -s . -l tcp://0.0.0.0:${PORT}"
