FROM node:16.13.2-alpine3.15
WORKDIR /usr/src/app
COPY ./package.json ./
RUN npm install
COPY ./*.js ./
COPY ./util/*.js ./util/
COPY ./.env ./

# Run the node service on container startup
CMD [ "npm",  "start"]