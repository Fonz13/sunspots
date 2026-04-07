from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import datetime
import pysolar.solar as pysolar
from typing import List

app = FastAPI(title="AR Sun Tracker")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

class SunPosition(BaseModel):
    time: str
    azimuth: float
    altitude: float

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/api/sun-path", response_model=List[SunPosition])
async def get_sun_path(lat: float, lon: float, date: str = None, offset: int = 0):
    """
    Returns the sun path for a given date for the entire day (24 hours).
    offset is the user's timezone offset from UTC in minutes.
    """
    if date:
        try:
            target_date = datetime.datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            target_date = datetime.datetime.now(datetime.timezone.utc).date()
    else:
        target_date = datetime.datetime.now(datetime.timezone.utc).date()

    path = []
    
    # Calculate exactly 00:00 of the specified date in the user's local time!
    # offset in JS is (UTC - Local) in minutes. So UTC time = Local + offset
    start_dt = datetime.datetime(
        target_date.year, 
        target_date.month, 
        target_date.day, 
        tzinfo=datetime.timezone.utc
    ) + datetime.timedelta(minutes=offset)

    for i in range(0, 24 * 60 + 1, 20):  # Every 20 mins up to exactly 24 hours
        current_dt = start_dt + datetime.timedelta(minutes=i)
        
        # Calculate position
        altitude = pysolar.get_altitude(lat, lon, current_dt)
        azimuth = pysolar.get_azimuth(lat, lon, current_dt)
        
        path.append(SunPosition(
            time=current_dt.isoformat(),
            azimuth=azimuth,
            altitude=altitude
        ))

    return path
