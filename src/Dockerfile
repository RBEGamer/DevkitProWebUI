FROM devkitpro/devkita64
MAINTAINER Marcel Ochsendorf <marcel.ochsendorf@gmail.com>

RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --shell /bin/bash --create-home node


RUN curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
RUN apt-get install -y nodejs


WORKDIR /usr/src/app
COPY ./app ./
#COPY package*.json ./
RUN npm install



ADD ./app/build_files ./build_files

EXPOSE 3015



CMD [ "node", "server.js" ]

