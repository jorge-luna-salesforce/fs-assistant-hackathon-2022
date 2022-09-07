FROM node:16.13.2-alpine3.15
WORKDIR /usr/src/app
COPY ./package.json ./
RUN npm install
COPY ./fsl-hackathon-2022-55239864ff67.json ./
COPY ./*.js ./
COPY ./.env ./

# Run the node service on container startup
CMD [ "npm",  "start"]