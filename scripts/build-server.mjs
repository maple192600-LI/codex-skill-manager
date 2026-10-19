import {build} from 'esbuild';
await build({entryPoints:['server/server.mjs'],bundle:true,platform:'node',format:'esm',target:'node24',loader:{'.html':'text'},outfile:'server/server.bundle.mjs',legalComments:'eof'});
