.PHONY: build run stop logs

IMAGE_NAME = sunspots-app
CONTAINER_NAME = sunspots-container
PORT = 8000

build:
	docker build -t $(IMAGE_NAME) .

run:
	docker run -d --name $(CONTAINER_NAME) -p $(PORT):8000 -v $(shell pwd):/app $(IMAGE_NAME)
	@echo "App running at http://localhost:$(PORT)"

stop:
	docker stop $(CONTAINER_NAME) || true
	docker rm $(CONTAINER_NAME) || true

logs:
	docker logs -f $(CONTAINER_NAME)


