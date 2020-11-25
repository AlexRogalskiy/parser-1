const _ = require('the-lodash');
const InfraScope = require('./infra');
const NamespaceScope = require('./namespace');
const LogicItem = require('../item');
const LabelMatcher = require('./label-matcher');

class LogicScope
{
    constructor(context)
    {
        this._context = context;
        this._logger = context.logger.sublogger("LogicScope");

        this._itemsMap = {}
        this._itemKindMap = {}
        this._root = LogicItem.constructTop(this);

        this._namespaceScopes = {};
        this._infraScope = new InfraScope(this);

        this._namespaceLabelMatcher = new LabelMatcher();
    }

    get logger() {
        return this._logger;
    }

    get concreteRegistry() {
        return this._context.concreteRegistry;
    }

    get root() {
        return this._root;
    }

    _acceptItem(item) 
    {
        this._itemsMap[item.dn] = item;

        if (!this._itemKindMap[item.kind]) {
            this._itemKindMap[item.kind] = {};
        }
        this._itemKindMap[item.kind][item.dn] = item;
    }

    _dropItem(item) 
    {
        delete this._itemsMap[item.dn];
        delete this._itemKindMap[item.kind][item.dn];
    }

    extractItems() {
        return _.values(this._itemsMap);
    }

    findItem(dn)
    {
        var item = this._itemsMap[dn];
        if (!item) {
            item = null;
        }
        return item;
    }
    
    getInfraScope() {
        return this._infraScope;
    }

    getNamespaceScope(name) {
        if (!this._namespaceScopes[name]) {
            this._namespaceScopes[name] = new NamespaceScope(this, name);
        }
        return this._namespaceScopes[name];
    }

    getNamespaceScopes() {
        return _.values(this._namespaceScopes);
    }
    
    registerNamespaceLabels(name, labelsMap)
    {
        let namespaceScope = this.getNamespaceScope(name);
        this._namespaceLabelMatcher.register(labelsMap, namespaceScope);
    }

    findNamespaceScopesByLabels(selector)
    {
        return this._namespaceLabelMatcher.match(selector);
    }

    setK8sConfig(logicItem, config)
    {
        {
            logicItem.setConfig(config);
            logicItem.addProperties({
                kind: "yaml",
                id: "config",
                title: "Config",
                order: 10,
                config: config
            });
        }

        {
            var labels = _.get(config, 'metadata.labels');
            labels = this._normalizeDict(labels);
            logicItem.addProperties({
                kind: "key-value",
                id: "labels",
                title: "Labels",
                order: 8,
                config: labels
            });
        }

        {
            var annotations = _.get(config, 'metadata.annotations');
            annotations = this._normalizeDict(annotations);
            logicItem.addProperties({
                kind: "key-value",
                id: "annotations",
                title: "Annotations",
                order: 9,
                config: annotations
            });
        }
    }

    _normalizeDict(dict)
    {
        dict = dict || {};

        var res = {};
        for(var key of _.sortBy(_.keys(dict)))
        {
            res[key] = dict[key];
        }
        return res;
    }

    fetchInfraRawContainer()
    {
        var infra = this.root.fetchByNaming("infra", "Infrastructure");
        infra.order = 1000;
        return infra;
    }

    fetchRawContainer(item, name)
    {
        var nsName = item.config.metadata.namespace;
        return this.fetchNamespaceRawContainer(nsName, name)
    }

    fetchNamespaceRawContainer(nsName, name)
    {
        var namespace = this.root.fetchByNaming("ns", nsName);
        var rawContainer = namespace.fetchByNaming("raw", "Raw Configs");
        rawContainer.order = 1000;
        var container = rawContainer.fetchByNaming("raw", name);
        return container;
    }
    
    findAppItem(namespace, name)
    {
        return this._findItem([
            {
                kind: "ns",
                name: namespace
            },
            {
                kind: "app",
                name: name
            }
        ]);
    }

    _findItem(itemPath)
    {
        var item = this.root;
        for(var x of itemPath) {
            item = item.findByNaming(x.kind, x.name);
            if (!item) {
                return null;
            }
        }
        return item;
    }

    extractCapacity()
    {
        var cap = [];
        for(var kind of _.keys(this._itemKindMap))
        {
            cap.push({
                kind: kind,
                count: _.keys(this._itemKindMap[kind]).length
            });
        }
        cap = _.orderBy(cap, ['count', 'kind'], ['desc', 'asc']);
        return cap;
    }

    debugOutputCapacity()
    {
        this.logger.info("[Scope] >>>>>>>");
        this.logger.info("[Scope] Total Count: %s", _.keys(this._itemsMap).length);

        const caps = this.extractCapacity();
        for(let x of caps)
        {
            this.logger.info("[Scope] %s :: %s", x.kind, x.count);
        }

        this.logger.info("[Scope] <<<<<<<");
    }
}

module.exports = LogicScope;