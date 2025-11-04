param(
    [string]$Python = "python"
)

& $Python -m pip install -U pip
& $Python -m pip install -U -r requirements-client.txt
Write-Host "Client dependencies installed. Run: python main.py client --server http://<agent-ip>:8080"





