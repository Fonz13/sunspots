# Google Maps API Security for Static Sites

This document explains how API keys are secured when used in a client-side environment like a static GitHub Pages website.

## 1. The "Public by Design" Model
Because this app is a **static site**, everything the browser needs to run (HTML, CSS, JS) is sent to the user's computer. This means any API key used to load maps **is technically visible** to anyone who inspects the page source or network traffic.

Google Maps API keys are designed with this in mind. They are not intended to be "secret" like database passwords; instead, they are designed to be **"Locked."**

## 2. Protection via Domain Restrictions
The primary security layer for Google Maps is **Browser Referrer Restriction**. 

In the Google Cloud Console, you "lock" the key to a specific domain (e.g., `https://fonzieforsman.github.io/*`).

- **How it works**: When your app requests a map, the browser sends the "Referer" header. Google checks this against your allowed list.
- **The Result**: If someone copies your key and tries to use it on `their-stolen-site.com`, Google will see the domain mismatch and **block the request instantly.**

> [!IMPORTANT]
> A compromised key on a restricted domain only costs you money if your own site is abused. It cannot be used to power someone else's website.

## 3. The Role of GitHub Secrets
Even though the key is "public" on the live site, we keep it out of the **GitHub Source Code** using GitHub Secrets and Actions.

### Why do this?
1. **Clean History**: It keeps the key out of your version control history. If you ever make the repo private or share it, you don't have to worry about a "live" key being in the commits.
2. **Bot Prevention**: There are bots that crawl GitHub repositories searching for API keys. Keeping the key in a Secret ensures it never enters your Git history.
3. **Multi-API Risk**: If you accidentally enable *other* APIs on the same key (like Google Vision or Translate) that *don't* support domain restrictions, those could be abused if the key is in plain text.

## 4. Best Practices Checklist
- [ ] **Restrict by Website**: Only allow your production URL and `localhost`.
- [ ] **Restrict by API**: Only enable the "Maps JavaScript API" and "Places API" for this key.
- [ ] **Set Quotas**: Set a daily budget or request cap (e.g., 150/day) in the GCP Console to prevent cost surges.
- [ ] **Rotate Keys**: If you ever suspect a key is being abused, you can "rotate" it (generate a new one and delete the old one) in seconds.
