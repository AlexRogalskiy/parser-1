const _ = require('the-lodash');

class DebugObjectLogger
{
    constructor(context)
    {
        this._logger = context.logger;
    }

    dump(name, iteration, obj)
    {
        try
        {
            if (!process.env.LOG_TO_FILE) {
                return;
            }
    
            if (!obj) {
                return;
            }
    
            var writer = this._logger.outputStream(name + iteration + ".json");
            if (writer) {
                writer.write(_.cloneDeep(obj));
                writer.close();
            }
        }
        catch(reason)
        {
            this._logger.error("[DebugObjectLogger::dump] ", reason);
        }
    }
}

module.exports = DebugObjectLogger;