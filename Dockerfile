FROM node:16.13.2-alpine3.15
WORKDIR /usr/src/app
COPY ./package.json ./
RUN npm install
COPY ./*.js ./
RUN npm run start