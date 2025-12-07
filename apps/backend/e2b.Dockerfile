FROM e2bdev/code-interpreter:latest 

WORKDIR /home/user

RUN sudo apt-get update && sudo apt-get install -y s3fs zip && sudo rm -rf /var/lib/apt/lists/*

COPY template/ /home/user/

RUN npm install

CMD ["npm", "run", "dev"]
