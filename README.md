# Daily Flow Studio

A personalized, minimal daily schedule maker that helps you map a focused day in minutes. Adjust focus profiles, capture tasks with energy tags, and let the builder pace intentional breaks and rituals for you. Built with Next.js and Tailwind CSS so it can be deployed straight to Vercel.

## Local Development

First, run the development server:

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to start crafting a schedule. Edits in `src/app/page.tsx` will hot reload instantly.

## Available Scripts

- `npm run dev` – start the dev server
- `npm run lint` – run ESLint
- `npm run build` – create a production build
- `npm run start` – run the production build locally

## Deploying

Deploy to Vercel with:

```bash
vercel deploy --prod --yes --token $VERCEL_TOKEN --name agentic-211a87a2
```

Make sure `VERCEL_TOKEN` is available in your environment. The production URL is `https://agentic-211a87a2.vercel.app`.
