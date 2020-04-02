const _ = require("the-lodash");
const fs = require("fs");
const path = require("path");
const Scope = require("./scope");

class LogicProcessor 
{
    constructor(context)
    {
        this._context = context;
        this._logger = context.logger.sublogger("LogicProcessor");

        this._parsers = [];
        this._extractParsers();

        this._polishers = [];
        this._extractPolishers();
    }

    get logger() {
        return this._logger;
    }

    _extractParsers()
    {
        this.logger.info('[_extractParsers] ...');
        var files = fs.readdirSync(path.join(__dirname, "parsers"));
        files = _.filter(files, x => x.endsWith('.js'));
        for(var x of files)
        {
            this.logger.info('[_extractParsers] %s', x);
            this._loadParser(x);
        }

        this._parsers = _.orderBy(this._parsers, [
            x => x.order,
            x => _.stableStringify(x.target)
        ]);

        for(var handlerInfo of this._parsers)
        {
            this._logger.info("[_extractParsers] HANDLER: %s -> %s, target:", 
                handlerInfo.order, 
                handlerInfo.name, 
                handlerInfo.target)
        }
    }

    _loadParser(name)
    {
        this.logger.info('[_loadParser] %s...', name);
        const parserModule = require('./parsers/' + name);

        var targets = null;
        if (parserModule.target) {
            targets = [parserModule.target];
        } else if (parserModule.targets) {
            targets = parserModule.targets;
        }

        for(var target of targets)
        {
            this.logger.info('[_loadParser] Adding %s...', name, target);

            var parser = _.clone(parserModule);
            if (_.isNullOrUndefined(parser.order)) {
                parser.order = 0;
            }
            parser.target = target;
            this._parsers.push(parser);
        }
    }

    _extractPolishers()
    {
        this.logger.info('[_extractPolishers] ...');
        var files = fs.readdirSync(path.join(__dirname, "polishers"));
        files = _.filter(files, x => x.endsWith('.js'));
        for(var x of files)
        {
            this.logger.info('[_extractPolishers] %s', x);
            this._loadPolisher(x);
        }

        this._parsers = _.orderBy(this._parsers, [
            x => x.order,
            x => _.stableStringify(x.target)
        ]);

        for(var handlerInfo of this._parsers)
        {
            this._logger.info("[_extractPolishers] HANDLER: %s -> %s, target:", 
                handlerInfo.order, 
                handlerInfo.name, 
                handlerInfo.target)
        }
    }

    _loadPolisher(name)
    {
        this.logger.info('[_loadPolisher] %s...', name);
        const polisherModule = require('./polishers/' + name);

        var targets = null;
        if (polisherModule.target) {
            targets = [polisherModule.target];
        } else if (polisherModule.targets) {
            targets = polisherModule.targets;
        }

        for(var target of targets)
        {
            this.logger.info('[_loadPolisher] Adding %s...', name, target);

            var polisher = _.clone(polisherModule);
            if (_.isNullOrUndefined(polisher.order)) {
                polisher.order = 0;
            }
            polisher.target = target;

            this._polishers.push(polisher);
        }
    }

    process()
    {
        try
        {
            this._logger.info("[process] BEGIN");

            var scope = new Scope(this._context);
    
            this._processParsers(scope);
            this._processPolishers(scope);
            this._propagete(scope);
    
            this._logger.info("[process] READY");
    
            this._context.facadeRegistry.acceptLogicItems(scope.extractItems());
    
            this._logger.info("[process] END");
    
            return this._dumpToFile(scope);
        }
        catch(reason)
        {
            this._logger.error("[process] ", reason);
        }
    }

    _processParsers(scope)
    {
        for(var handlerInfo of this._parsers)
        {
            this._processParser(scope, handlerInfo);
        }
    }

    _processParser(scope, handlerInfo)
    {
        this._logger.debug("[_processParser] Handler: %s -> %s, target:", 
            handlerInfo.order, 
            handlerInfo.name, 
            handlerInfo.target);

        var items = this._context.concreteRegistry.filterItems(handlerInfo.target);
        for(var item of items)
        {
            this._processHandler(scope, handlerInfo, item.id, item);
        }
    }

    _processHandler(scope, handlerInfo, id, item)
    {
        this._logger.silly("[_processHandler] Handler: %s, Item: %s", 
            handlerInfo.name, 
            id);

        var handlerArgs = {
            scope: scope,
            logger: this.logger,
            item: item,
            context: this._context,

            createdItems: [],
            createdAlerts: []
        }

        handlerArgs.hasCreatedItems = () => {
            return handlerArgs.createdItems.length > 0;
        }

        handlerArgs.createItem = (parent, name, params) => {
            if (!handlerInfo.kind) {
                throw new Error("Missing handler kind.")
            }
            params = params || {};
            var newObj = parent.fetchByNaming(handlerInfo.kind, name);
            if (params.order) {
                newObj.order = params.order;
            }
            handlerArgs.createdItems.push(newObj);
            return newObj;
        }

        handlerArgs.createK8sItem = (parent, params) => {
            params = params || {};
            var name = params.name || item.config.metadata.name;
            var newObj = handlerArgs.createItem(parent, name, params);
            scope.setK8sConfig(newObj, item.config);
            return newObj;
        }

        handlerArgs.createAlert = (kind, severity, date, msg) => {
            handlerArgs.createdAlerts.push({
                kind,
                severity,
                date,
                msg
            });
        }

        this._preprocessHandler(handlerInfo, handlerArgs);

        try
        {
            handlerInfo.handler(handlerArgs);
        }
        catch(reason)
        {
            this.logger.error("Error in %s parser. ", handlerInfo.name, reason);
        }

        for(var alertInfo of handlerArgs.createdAlerts)
        {
            for(var createdItem of handlerArgs.createdItems)
            {
                createdItem.addAlert(
                    alertInfo.kind, 
                    alertInfo.severity, 
                    alertInfo.date, 
                    alertInfo.msg);
            }
        }
    }

    _preprocessHandler(handlerInfo, handlerArgs)
    {
        handlerArgs.namespaceName = null;
        if (handlerInfo.needNamespaceScope || handlerInfo.needAppScope)
        {
            if (handlerInfo.namespaceNameCb) {
                handlerArgs.namespaceName = handlerInfo.namespaceNameCb(handlerArgs.item);
            } else {
                handlerArgs.namespaceName = handlerArgs.item.config.metadata.namespace;
            }
            if (handlerArgs.namespaceName)
            {
                handlerArgs.namespaceScope = handlerArgs.scope.getNamespaceScope(handlerArgs.namespaceName);
            }
        }

        handlerArgs.appName = null;
        if (handlerArgs.namespaceName)
        {
            if (handlerInfo.needAppScope)
            {
                if (handlerInfo.appNameCb) {
                    handlerArgs.appName = handlerInfo.appNameCb(handlerArgs.item);
                }
                handlerArgs.appInfo = handlerArgs.scope.getAppAndScope(
                    handlerArgs.namespaceName, 
                    handlerArgs.appName,
                    handlerInfo.canCreateAppIfMissing);

                if (handlerArgs.appInfo) {
                    handlerArgs.appScope = handlerArgs.appInfo.appScope;
                    handlerArgs.app = handlerArgs.appInfo.app;
                }
        
            }
        }
    }

    _processPolishers(scope)
    {
        for(var handlerInfo of this._polishers)
        {
            this._processPolisher(scope, handlerInfo);
        }
    }

    _processPolisher(scope, handlerInfo)
    {
        this._logger.silly("[_processPolisher] Handler: %s -> %s, target:", 
            handlerInfo.order, 
            handlerInfo.name, 
            handlerInfo.target);

        var path = _.clone(handlerInfo.target.path);
        this._visitTree(scope.root, 0, path, item => {
            this._logger.silly("[_processPolisher] Visited: %s", item.dn);
            this._processHandler(scope, handlerInfo, item.dn, item);
        });
    }

    _visitTree(item, index, path, cb)
    {
        this._logger.silly("[_visitTree] %s, path: %s...", item.dn, path);

        if (index >= path.length)
        {
            cb(item);
        }
        else
        {
            var top = path[index];
            var children = item.getChildrenByKind(top);
            for(var child of children)
            {
                this._visitTree(child, index + 1, path, cb);
            }
        }
    }

    _propagete(scope)
    {
        this._traverseTreeBottomsUp(scope, this._propagateFlags.bind(this));
    }

    _propagateFlags(node)
    {
        this.logger.silly("[_propagateFlags] %s...", node.dn)

        if (node.hasFlag('radioactive')) 
        {
            if (node.parent) 
            {
                node.parent.setFlag('radioactive');
            }
        }
    }

    _traverseTree(scope, cb)
    {
        var col = [scope.root];
        while (col.length)
        {
            var node = col.shift();
            cb(node);
            col.unshift(...node.getChildren());
        }
    }

    _traverseTreeBottomsUp(scope, cb)
    {
        var col = [];
        this._traverseTree(scope, x => {
            col.push(x);
        })

        for(var i = col.length - 1; i >= 0; i--)
        {
            var node = col[i];
            cb(node);
        }
    }

    _dumpToFile(scope)
    {
        return Promise.resolve()
            .then(() => {
                var writer = this.logger.outputStream("dump-logic-tree");
                if (writer) {
                    scope.root.debugOutputToFile(writer);
                    return writer.close();
                }
            })
            .then(() => {
                var writer = this.logger.outputStream("dump-logic-tree-detailed");
                if (writer) {
                    scope.root.debugOutputToFile(writer, { includeConfig: true });
                    return writer.close();
                }
            })
            .then(() => {
                var writer = this.logger.outputStream("exported-tree");
                if (writer) {
                    writer.write(this._context.facadeRegistry.logicTree);
                    return writer.close();
                }
            });
    }


}

module.exports = LogicProcessor;