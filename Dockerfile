FROM node:20-alpine
RUN npm i -g serve@14
WORKDIR /app
COPY index.html ./
EXPOSE 3000
CMD ["serve", "-s", ".", "-l", "3000"]
