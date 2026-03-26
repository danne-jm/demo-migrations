import { Project, SyntaxKind } from "ts-morph";
import * as path from "path";

// Hard-coded migration params
// Equivalent to: mod run . --recipe=org.yourorg.javascript.change-import
//   -PoldModule="@danieljaurellmevorach/fictional-logger"
//   -PoldMember="logging"
//   -PnewModule="@danieljaurellmevorach/fictional-logger"
//   -PnewMember="logV2"
const OLD_MODULE = "@danieljaurellmevorach/fictional-logger";
const OLD_MEMBER = "logging";
const NEW_MODULE = "@danieljaurellmevorach/fictional-logger";
const NEW_MEMBER = "logV2";

const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

console.log(`Scanning: ${targetDir}`);
console.log(`Renaming: ${OLD_MODULE}#${OLD_MEMBER} → ${NEW_MODULE}#${NEW_MEMBER}\n`);

const project = new Project({ skipAddingFilesFromTsConfig: true });

project.addSourceFilesAtPaths([ // These directories will be scanned for files to transform. Adjust as needed.
  `${targetDir}/**/*.ts`,
  `${targetDir}/**/*.tsx`,
  `${targetDir}/**/*.js`,
  `${targetDir}/**/*.jsx`,
  `!${targetDir}/**/node_modules/**`,
]);

const changedFiles: string[] = [];

for (const sourceFile of project.getSourceFiles()) {
  const matchingImports = sourceFile
    .getImportDeclarations()
    .filter((imp) => imp.getModuleSpecifierValue() === OLD_MODULE);

  for (const importDecl of matchingImports) {
    for (const namedImport of importDecl.getNamedImports()) {
      if (namedImport.getName() !== OLD_MEMBER) continue;

      const aliasNode = namedImport.getAliasNode();

      if (aliasNode) {
        // import { logging as foo } from '...'
        // Only the import specifier name changes; the local alias 'foo' and all
        // its usages are untouched (same behaviour as OpenRewrite alias handling).
        namedImport.setName(NEW_MEMBER);
      } else {
        // import { logging } from '...'
        // Type-aware rename: updates the import specifier AND every reference
        // in the project that is bound to this symbol — equivalent to
        // OpenRewrite's visitIdentifier / visitMethodInvocation / visitFunctionCall
        // / visitFieldAccess / visitNewClass type-attribution traversal.
        namedImport.getNameNode().asKindOrThrow(SyntaxKind.Identifier).rename(NEW_MEMBER);
      }

      // Update the module path when it changes (same module here, but kept for
      // correctness and parity with the OpenRewrite recipe's module-specifier
      // rewrite logic).
      if (OLD_MODULE !== NEW_MODULE) {
        importDecl.setModuleSpecifier(NEW_MODULE);
      }

      if (!changedFiles.includes(sourceFile.getFilePath())) {
        changedFiles.push(sourceFile.getFilePath());
      }
    }
  }
}

project.saveSync();

for (const filePath of changedFiles) {
  console.log(`Updated: ${filePath}`);
}

console.log(`\nDone. ${changedFiles.length} file(s) updated.`);
