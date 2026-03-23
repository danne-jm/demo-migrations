import { check, ExecutionContext, Recipe, TreeVisitor } from '@openrewrite/rewrite';
import { 
    JavaScriptVisitor, 
    pattern, 
    rewrite, 
    template, 
    usesMethod 
} from '@openrewrite/rewrite/javascript';
import { J } from '@openrewrite/rewrite/java';

export class MigrateUuidV4 extends Recipe {
    readonly name = "com.yourorg.updateLoggingDefinition";
    readonly displayName = "Migration Fictional Logger to V2";
    readonly description = "Rename logging functional definition, calls.";

    async editor(): Promise<TreeVisitor<any, ExecutionContext>> {
        return check(
            usesMethod("uuid v4(..)"),
            new MigrateUuidV4Visitor()
        );
    }
}

class MigrateUuidV4Visitor extends JavaScriptVisitor<ExecutionContext> {
    private beforeConfig = { 
        context: ["import { v4 } from 'uuid';"] 
    };
    
    private afterConfig = {
        // If rewrittenV4 requires an import, define it here.
        // OpenRewrite will automatically inject this import into the file if it applies the template.
        context: ["import { rewrittenV4 } from 'my-new-library';"]
    };

    private callRule = rewrite(() => ({
        before: pattern`v4()`.configure(this.beforeConfig),
        after: template`rewrittenV4()`.configure(this.afterConfig)
    }));

    protected async visitMethodInvocation(
        method: J.MethodInvocation,
        ctx: ExecutionContext
    ): Promise<J | undefined> {
        // ... applies the rewrite just as you had it
        return await this.callRule.tryOn(this.cursor, method)
            || await super.visitMethodInvocation(method, ctx);
    }
}