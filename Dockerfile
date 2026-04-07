FROM python:3.11-slim

WORKDIR /app

# Install uv entirely independently
RUN pip install uv

# Copy project definition files
COPY pyproject.toml .

# Install dependencies into system Python using uv
RUN uv pip install --system -r pyproject.toml

# Copy application files
COPY main.py .
COPY templates/ templates/
COPY static/ static/

# Expose the port
EXPOSE 8000

# Run the FastAPI app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
