const _ = require('the-lodash');

class PropertiesBuilder
{
    constructor(item, postBuildAction)
    {
        this._item = item;
        this._properties = {};
        this._postBuildAction = postBuildAction;
    }

    fromConfig(name, valuePath)
    {
        return this.fromObject(this._item.config, name, valuePath);
    }

    fromObject(obj, name, valuePath)
    {
        var value = _.get(obj, valuePath);
        if (!_.isUndefined(value)) {
            this.add(name, value);
        }
        return this;
    }

    add(name, value)
    {
        this._properties[name] = value;
        return this;
    }

    build()
    {
        if (this._postBuildAction) {
            return this._postBuildAction(this._properties);
        }
        return this._properties;
    }
}

module.exports = PropertiesBuilder;