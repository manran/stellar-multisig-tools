import { defineDocs } from 'fumadocs-mdx/macro';
import { loader } from 'fumadocs-core/source';

const docs = defineDocs({
  dir: 'content/stellar',
});

export const source = loader({
  baseUrl: '/stellar',
  source: docs.toFumadocsSource(),
});
