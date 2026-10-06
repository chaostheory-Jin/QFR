This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Use `frontend` as the project root, Node.js 22.x, and the normal Next.js build
(`npm run build`). The dashboard uses browser IndexedDB for uploads, original
files, import batches and review history; no database or server filesystem path
needs configuring. Do **not** point durable storage at `/tmp`.

Data is isolated by browser profile and site origin. Clearing site data, browser
eviction or changing to a different deployment URL can make previous records
unavailable. Download originals/export reports for backup. Existing server-side
records are not automatically copied into browser storage.

AI analysis is still a server request and needs a key supplied on login, or
`OPENAI_API_KEY_QFR`/`OPENAI_API_KEY` in Vercel environment settings. Never use a
`NEXT_PUBLIC_` variable for secrets. Selected documents are sent to the analysis
service. Analysis upload batching respects the hosted request size budget;
browser storage does not remove Vercel's 4.5 MB function request limit.

`/payroll` contains a clearly labelled deterministic mock register (12 employees,
9 pay runs, 108 payslips), filtering, Excel exports, payslip calculations and
local review decisions. It is not a payroll payment or statutory tax engine.

Verification: `npm test` (live AI tests opt-in), `npx tsc --noEmit`, `npm run build`.

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
