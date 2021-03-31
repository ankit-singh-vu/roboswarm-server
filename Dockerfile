FROM node:14-alpine
WORKDIR /usr/src/app
COPY . .
RUN apk update && apk add zip unzip iputils
RUN npm install && npm run build
EXPOSE 8080