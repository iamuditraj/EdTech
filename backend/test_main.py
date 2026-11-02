import pytest
from fastapi.testclient import TestClient
from main import app

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c

def test_get_schools(client):
    response = client.get("/api/schools")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
