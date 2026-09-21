import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '../..');
const contentRoot = path.resolve(process.cwd(), 'content/stellar');

const sections = {
  architecture: [
    'DEPLOYMENT_TOPOLOGY.md',
    'PRODUCT_SEMANTICS.md',
    'WORKFLOW_ARCHITECTURE.md',
    'OPERATION_ARCHITECTURE.md',
    'AUTHORITY_GRAPH.md',
    'MULTI_AUTHORITY_INTENTS.md',
    'INTEGRATION_PRODUCT_MODEL.md',
    'EVENT_SOURCED_HISTORY_AND_AUDIT.md',
    'PRIVACY_AUDIT_MODEL.md',
    'POSTGRES_PERSISTENCE_MODEL.md',
  ],
  operations: [
    'PRODUCTION_READINESS.md',
    'POSTGRES_CUTOVER_RUNBOOK.md',
    'POSTGRES_RECOVERY_RUNBOOK.md',
    'MAINNET_SMOKE_PLAN.md',
  ],
  development: [
    'PLATFORM_EXTENSION_POINTS.md',
    'SOROBAN_ABI_PRODUCT_MODEL.md',
    'SOROBAN_AUTHORIZATION.md',
    'WEBHOOK_DELIVERY_MODEL.md',
  ],
};

function slugFor(filename) {
  return filename
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/_/g, '-');
}

function titleFor(markdown, filename) {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();

  return filename
    .replace(/\.md$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function stripFirstHeading(markdown) {
  return markdown.replace(/^#\s+.+\r?\n+/, '');
}

for (const [section, files] of Object.entries(sections)) {
  const outputDirectory = path.join(contentRoot, section);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const pages = [];

  for (const filename of files) {
    const sourcePath = path.join(repoRoot, filename);
    const markdown = await readFile(sourcePath, 'utf8');
    const slug = slugFor(filename);
    const title = titleFor(markdown, filename);
    const body = stripFirstHeading(markdown).trimStart();

    pages.push(slug);

    const projected = [
      '---',
      `title: ${JSON.stringify(title)}`,
      `description: ${JSON.stringify(`Internal engineering source: ${filename}`)}`,
      '---',
      '',
      `> Source: \`${filename}\`. Edit the repository source, not this generated page.`,
      '',
      body,
      '',
    ].join('\n');

    await writeFile(path.join(outputDirectory, `${slug}.md`), projected);
  }

  await writeFile(
    path.join(outputDirectory, 'meta.json'),
    JSON.stringify({
      title: section[0].toUpperCase() + section.slice(1),
      pages,
    }, null, 2) + '\n',
  );
}

console.log(
  Object.entries(sections)
    .map(([section, files]) => `${section}=${files.length}`)
    .join(' '),
);
