# User guide — Stabsstöd (English)

Stabsstöd is a support system for an incident management staff. Everything you
write is saved locally in the browser first and synced to the server when you
are back online. You can work fully offline.

## Getting started

1. Open the web address shared by your administrator (e.g.
   `https://stabsstod.example.com/`).
2. Log in with your username and password.
3. If you are a new user or were issued a temporary password: you are asked to
   change your password immediately. The new password must be at least 12
   characters, contain at least one letter and one digit, and must not equal
   your username.

## Create an incident

1. Click **Incidents** in the top menu.
2. Click **Create incident**.
3. Enter the incident name, type, and start time. Choose which functions to
   pre-create.
4. Click **Create incident**. You are taken to the incident workspace.

## Workspace tabs

- **Situation** — situation picture, facts (verified / assumption / information
  need).
- **Direction** — mission and direction (written by chief of staff /
  deputy chief).
- **Coordination** — decisions and decision requests.
- **Logbook** — events and notes during the incident.
- **Map** — drawn map features (point, line, polygon, circle).
- **Staff** — members, shifts, resources, actors.
- **Reports** — (coming soon).

## Situation — facts

In the Situation tab you can create facts and mark them as verified,
assumption, or information need. Every change creates a new version; old
versions are kept. If two people edit the same fact at the same time, a
conflict is shown — choose which version should apply.

## Map — draw objects

1. Click **Map**.
2. Choose a drawing mode in the toolbar: **Point**, **Line**, **Polygon** or
   **Circle** (or **Select** to mark existing features).
3. Click on the map to draw.
4. Fill in name, layer, severity, validity, and description.
5. Click **Save object**.

Layers you don't want to see can be hidden in the list at bottom right of the
map. Retracted objects remain in history but are hidden from the map.

## Logbook

Write events in the logbook under the **Logbook** tab. Choose a category
(event, information, decision, contact, other) and an event time. Retracted
log entries are shown struck through.

Note: the log may be shared outside the staff room. Write factually and avoid
sensitive information.

## Working offline

- The header shows "Offline" when you have no network connection.
- You can still create and edit entries, facts, map features, etc. Everything
  is saved locally and queued for upload.
- When you are back online, your changes sync automatically, and changes from
  others in the staff are pulled down.
- If two people changed the same thing while one was offline, a conflict is
  shown that you can resolve.

## PWA (install the app)

If your device trusts the server's CA certificate, you can install the app as a
Progressive Web App (PWA). It appears on the home screen and opens even without
a connection. Ask your administrator for the CA certificate if offline mode
does not work.

## Language

Choose Swedish or English with the language button in the top menu.
