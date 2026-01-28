import azure.functions as func

from routes.health import bp as health_bp
from routes.grid import bp as grid_bp

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
app.register_functions(health_bp)
app.register_functions(grid_bp)
