import { Promise } from 'the-promise';
import { ILogger } from 'the-logger';

import { Context } from '../context';

import { K8sLoader, ReadyHandler } from './k8s';

import { connectFromPod  } from 'k8s-super-client';

export class LocalLoader 
{
    private _context : Context;
    private _logger : ILogger;

    private _loader : any;
    private _readyHandler? : ReadyHandler;

    constructor(context  : Context)
    {
        this._context = context;
        this._logger = context.logger.sublogger("LocalLoader");
        
        this.logger.info("Constructed");
    }

    get logger() : ILogger {
        return this._logger;
    }

    setupReadyHandler(handler : ReadyHandler)
    {
        this._readyHandler = handler;
        if (this._loader) {
            this._loader.setupReadyHandler(this._readyHandler);
        }
    }
    
    run()
    {
        return connectFromPod(this._logger)
            .then(client => {
                let info = {
                    infra: "local"
                }
                this._loader = new K8sLoader(this._context, client, info);
                this._loader.setupReadyHandler(this._readyHandler);
                return this._loader.run();
            })
    }
}