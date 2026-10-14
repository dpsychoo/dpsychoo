# Qualitative focus radar evidence

The classifications below are the profile owner's approved descriptions of professional focus. Public project documentation is recorded separately as context and evidence; it does not independently verify the owner's self-description or audit the private SGX VI implementation. These categories describe focus, not proficiency. They make no claims of enterprise delivery, certification, uptime, or customer adoption.

## Classification key

- **CORE** — owner-approved primary current engineering focus, with public project context where available.
- **SUPPORTING** — owner-approved complementary focus supported by documented project context where available.
- **EXPLORING** — owner-approved developing or future area; public evidence may be limited.
- **UNASSESSED** — reserved for dimensions where the owner has not assigned a focus category.

In the SVG, CORE sits on the outer focus ring, SUPPORTING on the middle ring, and EXPLORING on the inner ring. These are categorical display positions only. UNASSESSED has no plotted point. The radial positions are not scores, measurements, percentages, or skill metrics. The charts do not measure proficiency, performance, seniority, certification, or years of experience.

## Radar A — Product & Frontend Engineering

| Dimension | Owner-approved focus | Public evidence and limits |
| --- | --- | --- |
| TypeScript | SUPPORTING | The [SGX VI technology stack](https://github.com/dpsychoo/gta-vi-generator-showcase#technology-stack) lists TypeScript for the frontend. This documents the product's stated technology choice; its commercial source is not public for implementation review. |
| React / UI Components | SUPPORTING | The [SGX VI case study](https://github.com/dpsychoo/gta-vi-generator-showcase) lists React and includes desktop and mobile creation-interface captures. These materials do not establish component-system scale or quality. |
| Interface Engineering | CORE | SGX VI documents an image-upload and consent flow. [Uchiha Itachi](https://github.com/dpsychoo/Itachi_SGODX) documents an interactive visual interface with section navigation and responsive behavior. The projects provide public interface context; SGX VI's implementation remains private. |
| Responsive Interfaces | SUPPORTING | The [SGX VI case study](https://github.com/dpsychoo/gta-vi-generator-showcase) documents responsive controls and a 390px mobile capture. The Itachi README documents desktop and mobile layouts. This does not establish formal device-coverage testing. |
| Interactive Experiences | CORE | The Itachi project documents scroll-linked frames, pointer and touch interaction, Canvas 2D, WebGL, SVG effects, and reduced-motion handling. SGX VI documents an immersive presentation. This does not imply graphics research or model engineering. |
| Product Engineering | CORE | The [SGX VI case study](https://github.com/dpsychoo/gta-vi-generator-showcase) describes the product journey from image input and consent through hosted payment and digital delivery, and names David Castro as builder. The public materials describe the flow; they are not an independent implementation audit or evidence of enterprise adoption. |

## Radar B — Platform, Data & Automation

| Dimension | Owner-approved focus | Public evidence and limits |
| --- | --- | --- |
| Backend / APIs | SUPPORTING | The SGX VI [public architecture overview](https://github.com/dpsychoo/gta-vi-generator-showcase#high-level-architecture) describes a private application service and its payment, AI, data, and delivery provider roles. No endpoint definitions or backend source are public. The Itachi project explicitly has no business API or backend. |
| PostgreSQL / Data | EXPLORING | This category reflects the owner's report of SQL study and Supabase migration preparation. The public SGX VI showcase documents Supabase for managed data and file storage, but does not expose PostgreSQL schema or query implementation; the Itachi README says it has no database or persistent application storage. This is not a claim of production database deployment, completed migrations, DBA work, or enterprise implementation. |
| Supabase | SUPPORTING | The SGX VI [technology stack and architecture](https://github.com/dpsychoo/gta-vi-generator-showcase#technology-stack) document Supabase for managed data and files. This records provider use in product context; the public showcase is not a source-code audit. |
| AI Integrations | SUPPORTING | SGX VI documents OpenAI as the image-processing provider in its [technology stack and product architecture](https://github.com/dpsychoo/gta-vi-generator-showcase#technology-stack). This supports API/provider integration context, not model training or advanced ML engineering. |
| Automation | EXPLORING | Public profile workflows automate generation and publication of profile assets. This supports developer/profile workflow context only. The statistics workflow proposal in `docs/proposals/` is inactive and is not treated as delivered work. EXPLORING does not claim enterprise, business-process, or industrial automation delivery. |
| Cloud Deployment | SUPPORTING | SGX VI documents Vercel hosting and application execution. Itachi documents static hosting and links its deployed project. This does not establish infrastructure topology, security certification, uptime, or enterprise operations. |

The owner-approved labels are the final qualitative focus description for these dimensions. Public evidence remains limited to the public artifacts cited above and should not be read as independent verification of private work or capability. `UNASSESSED` remains available in the renderer for any future dimension without an owner-approved focus category.
