# Realistic Driver Model (Santa Clara County)

This project idea only becomes believable if we model **(1) what a driver is legally allowed to pick up**, and **(2) what actually pays in practice**.

## Reality Check: Why Cardboard-Only Doesn't Work

If a pickup truck can carry about **500 lb of flattened cardboard**:

- Cardboard (OCC) is often on the order of **$0.03/lb** (can swing, but this is a realistic ballpark).
- **Gross**: `500 lb * $0.03/lb = $15`
- Typical costs (rough, but realistic order of magnitude):
  - 25-40 miles of driving (gas + wear): `~$14–$22`
  - Stop friction (5 min/stop + supplies): `~$10+`
  - Yard/MRF unload + waiting time: 30-60 minutes

So the expected outcome is **near $0 net or negative**. A rational driver does *not* do "household cardboard pickups" for scrap value alone.

## Government / Legal Constraints You Must Respect

To keep this believable, the app must explicitly avoid "recycling scavenging" and operate as **opt-in pickup**:

- **No curbside scavenging**: Taking material out of curbside bins is typically prohibited by city ordinances and/or treated as theft of service. Your model should assume pickups are **posted by the household/business** and left out with consent.
- **Exclusive hauling/franchise realities**: Many cities grant exclusive collection rights for commercial waste/recycling. If you want business cardboard pickups, assume:
  - Bin2Bucks is a **subcontractor to the franchised hauler**, or
  - you only operate where it is explicitly allowed, or
  - you only pick up materials under a contract that the city/hauler permits.
- **E-waste constraints**: Electronics should go to approved collection/recycling channels. In reality, e-waste is usually a **service**, not a commodity (especially CRTs).
- **Hazardous materials**: Drivers should reject paint/chemicals/sharps/etc. Batteries also require special handling; don’t silently accept them in a gig pickup model.

This means the driver workflow has to include: proof of consent (in-app), material acceptance rules, and compliant drop-off partners.

## What Actually Makes a Driver Do This

A believable model is:

- **Scrap value is a bonus, not the paycheck**
- Drivers are paid through a **per-stop service fee** (household convenience fee or municipal/producer subsidy)
- The platform maximizes driver earnings by:
  - pre-qualifying stops (avoid $1 jobs),
  - routing density (minimize miles/stop),
  - focusing on special-handling/high-friction items people don’t want to self-haul (bulk cardboard, scrap items, e-waste pickup with fee),
  - optionally adding commercial cardboard pickups only if franchising/permits are solved.

## Simulation + Mock Drill (Runs in Repo)

We implemented a realistic driver-day simulator at:

- `backend/tools/simulate_driver_day.py`

It prints:

1) scrap-only economics (not viable), and  
2) fee-backed pickup economics (viable), and  
3) a stop-by-stop mock drill route.

Run:

```bash
python3 backend/tools/simulate_driver_day.py --days 200 --truck-capacity-lbs 500 --shift-minutes 360
python3 backend/tools/simulate_driver_day.py --mock-drill --truck-capacity-lbs 500 --shift-minutes 360
python3 backend/tools/simulate_driver_day.py --mock-drill --include-commercial --truck-capacity-lbs 500 --shift-minutes 360
```

### What The Simulator Demonstrates

- **Policy A/B (scrap-only)**: median net is near zero (drivers won’t do it).
- **Policy C (fee-backed)**: viable net, because revenue is driven by per-stop fees and only secondarily by scrap.

## Household "How Much Recyclable Exists?"

Using a simple, defensible baseline:

- EPA national recycling benchmark: ~`1.16 lb/person/day`
- Santa Clara County household size: ~`2.82 persons/household`
- Implied average recyclables: `~3.27 lb/household/day` (`~22.9 lb/week`)

Implication:

- A 10-15 stop route has a baseline pool of roughly `~230–340 lb` **per week equivalent**.
- To fill a `~500 lb` pickup in a single run, you need either:
  - bulk/move-out stops, or
  - commercial pickups, or
  - many more households, which raises miles + time and destroys profitability without fees.
