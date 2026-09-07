"""
Simple perturbation calculation without poliastro dependencies.
Calculate J2, J3 and atmospheric-drag perturbations using direct formulas.

Reference generator for `tests/perturbation_test_data.json`, consumed by
`src/lib/perturbation.test.ts`. numpy is not part of the project's toolchain,
so use the inline PEP-723 dependency block below via uv. Run from this
directory (it writes the JSON to the working directory):

    uv run simple_perturbation_calc.py

The drag term mirrors the *default* (exponential) atmosphere of
`src/lib/perturbation.ts`, i.e. what `calculateDetailedPerturbationRates` uses
when no `atmosphereModel` argument is supplied.
"""

# /// script
# requires-python = ">=3.9"
# dependencies = [
#   "numpy",
# ]
# ///

import numpy as np
import json

# Physical constants (matching TypeScript implementation)
MU = 3.986004418e14  # m³/s²
RE = 6378137.0  # m
J2 = 1.08263e-3
J3 = -2.532e-6

# Defaults of DEFAULT_ATMOSPHERE_MODEL / calculateDetailedPerturbationRates
BALLISTIC_COEFFICIENT = 0.012  # m^2/kg
REFERENCE_ALTITUDE_KM = 400.0
SCALE_HEIGHT_KM = 60.0
REFERENCE_DENSITY = 1e-12  # kg/m^3
LOW_ORBIT_LIMIT_KM = 1000.0


def exponential_density(altitude_km):
    """DEFAULT_ATMOSPHERE_MODEL exponential profile, kg/m^3."""
    return REFERENCE_DENSITY * np.exp(
        -(altitude_km - REFERENCE_ALTITUDE_KM) / SCALE_HEIGHT_KM
    )


def calculate_drag_rates(a_km, e, ballistic_coefficient=BALLISTIC_COEFFICIENT):
    """
    Secular drag rates for a near-circular orbit.

    da/dt = -rho * B * sqrt(mu * a)          (textbook circular-orbit decay)
    de/dt = (da/dt) * e / (2H)               (King-Hele small-e limit)

    Written here in the same `F = 0.5 * rho * v_rel * B` [1/s] form the
    TypeScript uses so the two stay easy to diff. Note the single power of
    v_rel: F is a rate, not the drag acceleration.
    """
    a = a_km * 1000.0
    perigee_altitude = a * (1 - e) - RE

    if perigee_altitude >= LOW_ORBIT_LIMIT_KM * 1000.0:
        return 0.0, 0.0  # drag gate: high orbits get nothing

    rho = exponential_density(perigee_altitude / 1000.0)
    v_rel = np.sqrt(MU / a)
    F = 0.5 * rho * v_rel * ballistic_coefficient
    da_dt = -2 * a * F                                     # m/s
    de_dt = da_dt * e / (2 * SCALE_HEIGHT_KM * 1000.0)     # 1/s

    # Cross-check against the closed form the docstring advertises.
    closed_form = -rho * ballistic_coefficient * np.sqrt(MU * a)
    assert abs(da_dt - closed_form) <= 1e-12 * abs(closed_form), (
        f"da/dt {da_dt} != closed form {closed_form}"
    )

    return da_dt, de_dt

def calculate_j2_j3_rates(a_km, e, i_deg, raan_deg, argp_deg, nu_deg):
    """Calculate J2, J3 and drag perturbation rates for given orbital elements."""
    
    # Convert to SI units and radians
    a = a_km * 1000  # m
    i = np.radians(i_deg)
    
    # Mean motion
    n = np.sqrt(MU / a**3)
    
    # Helper terms
    beta = (1 - e**2)**2
    gamma = (1 - e**2)**3
    k2 = 1.5 * J2 * RE**2
    k3 = 0.5 * J3 * RE**3
    
    sin_i = np.sin(i)
    cos_i = np.cos(i)
    sin_i_sq = sin_i**2
    
    # J2 rates (rad/s)
    j2_dOmega_dt = -k2 * n * cos_i / (a**2 * beta)
    j2_domega_dt = k2 * n * (2 - 2.5 * sin_i_sq) / (a**2 * beta)
    j2_dM_dt = n + k2 * n * (1 - 3 * sin_i_sq) / (2 * a**2 * beta)
    
    # J3 rates (rad/s)
    j3_dOmega_dt = -k3 * n * sin_i / (a**3 * gamma)
    j3_domega_dt = k3 * n * (4 - 5 * sin_i_sq) * sin_i / (2 * a**3 * gamma)
    j3_de_dt = k3 * n * (1.5 * sin_i_sq - 1) * e / (a**3 * gamma)
    j3_di_dt = k3 * n * cos_i / (2 * a**3 * gamma)
    
    # Convert to practical units
    SECONDS_PER_YEAR = 365.25 * 24 * 3600
    DAYS_PER_YEAR = 365.25
    RAD_TO_DEG = 180 / np.pi
    
    da_dt_drag, de_dt_drag = calculate_drag_rates(a_km, e)

    return {
        "drag": {
            "da_dt_km_per_year": da_dt_drag * SECONDS_PER_YEAR / 1000,
            "de_dt_per_year": de_dt_drag * SECONDS_PER_YEAR,
        },
        "j2": {
            "dOmega_dt_deg_per_day": (j2_dOmega_dt * RAD_TO_DEG * SECONDS_PER_YEAR) / DAYS_PER_YEAR,
            "domega_dt_deg_per_day": (j2_domega_dt * RAD_TO_DEG * SECONDS_PER_YEAR) / DAYS_PER_YEAR,
        },
        "j3": {
            "de_dt_per_year": j3_de_dt * SECONDS_PER_YEAR,
            "di_dt_deg_per_year": j3_di_dt * RAD_TO_DEG * SECONDS_PER_YEAR,
            "dOmega_dt_deg_per_year": j3_dOmega_dt * RAD_TO_DEG * SECONDS_PER_YEAR,
            "domega_dt_deg_per_year": j3_domega_dt * RAD_TO_DEG * SECONDS_PER_YEAR,
        }
    }

# Test cases with different orbital configurations
test_cases = [
    {
        "name": "LEO circular orbit",
        "a_km": 6778.137,  # 400 km altitude
        "e": 0.001,
        "i_deg": 51.6,
        "raan_deg": 0.0,
        "argp_deg": 0.0,
        "nu_deg": 0.0,
    },
    {
        "name": "GEO orbit",
        "a_km": 42164.0,
        "e": 0.0002,
        "i_deg": 0.1,
        "raan_deg": 0.0,
        "argp_deg": 0.0,
        "nu_deg": 0.0,
    },
    {
        "name": "Molniya orbit",
        "a_km": 26600.0,
        "e": 0.72,
        "i_deg": 63.4,
        "raan_deg": 90.0,
        "argp_deg": 270.0,
        "nu_deg": 0.0,
    },
    {
        "name": "Sun-synchronous orbit",
        "a_km": 7078.137,  # 700 km altitude
        "e": 0.001,
        "i_deg": 98.2,
        "raan_deg": 0.0,
        "argp_deg": 0.0,
        "nu_deg": 0.0,
    },
]

# Generate test data
test_data = []
for case in test_cases:
    rates = calculate_j2_j3_rates(
        case["a_km"],
        case["e"],
        case["i_deg"],
        case["raan_deg"],
        case["argp_deg"],
        case["nu_deg"]
    )
    
    test_data.append({
        "name": case["name"],
        "input": {
            "semiMajorAxisKm": case["a_km"],
            "eccentricity": case["e"],
            "inclinationDeg": case["i_deg"],
            "raanDeg": case["raan_deg"],
            "argPerigeeDeg": case["argp_deg"],
            "meanAnomalyDeg": case["nu_deg"],
        },
        "expected": rates
    })

# Save test data
with open("perturbation_test_data.json", "w") as f:
    json.dump(test_data, f, indent=2)

print("Test data generated successfully!")
print(f"Generated {len(test_data)} test cases")

# Print sample output for verification
print("\nSample test case (LEO circular orbit):")
print(json.dumps(test_data[0], indent=2))