FROM node:12-alpine
WORKDIR /auth-server
ADD . /auth-server
RUN npm install
EXPOSE 3000
CMD npm start
