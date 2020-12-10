import _ from 'the-lodash';
import { Promise } from 'the-promise';
import { ILogger } from 'the-logger';

import * as DateUtils from '@kubevious/helpers/dist/date-utils';
import { HandledError } from '@kubevious/helpers/dist/handled-error';


export type JobDampenerHandler = (date : any, data : any) => void;

export class JobDampener
{
    private _logger : ILogger;

    private _handlerCb : JobDampenerHandler;

    private _jobQueue : any[] = [];
    private _isProcessing = false;
    private _isScheduled = false;
    private _queueSize = 5;
    private _rescheduleTimeoutMs = 5000;

    constructor(logger: ILogger, handler : JobDampenerHandler)
    {
        this._logger = logger;
        this._handlerCb = handler;
    }

    get logger() {
        return this._logger;
    }

    acceptJob(date : any, data : any)
    {
        this._jobQueue.push({ date: date, data: data});
        this._logger.info("[acceptJob] job date: %s. queue size: %s", date.toISOString(), this._jobQueue.length);

        this._filterJobs();

        this._tryProcessJob();
    }

    _filterJobs()
    {
        var timeDeltas = [];
        for(var i = 0; i < this._jobQueue.length - 1; i++)
        {
            var job = this._jobQueue[i];
            var nextJob = this._jobQueue[i + 1];
            var seconds = DateUtils.diffSeconds(nextJob.date, job.date);
            timeDeltas.push({
                index: i,
                diff: seconds
            })
        }

        var toRemoveCount = Math.max(this._jobQueue.length - this._queueSize, 0);

        if (toRemoveCount > 0)
        {
            var toRemove = _(timeDeltas).orderBy(['diff']).take(toRemoveCount).value();
            toRemove = _.orderBy(toRemove, ['index'], ['desc']);
            for(var x of toRemove)
            {
                this._jobQueue.splice(x.index, 1);
            }
        }
    }

    _processJob(job: any)
    {
        this.logger.info("[_processJob] BEGIN. Date: %s", job.date.toISOString());

        return Promise.resolve()
            .then(() => {
                return this._handlerCb(job.date, job.data);
            })
            .then(() => {
                this.logger.info("[_processJob] END");
                return {
                    success: true
                };
            })
            .catch(reason => {
                if (reason instanceof HandledError) {
                    this.logger.error('[_processJob] ERROR: %s', reason.message);
                } else {
                    this.logger.error('[_processJob] ERROR: ', reason);
                }
                return {
                    success: false
                };
            });
    }

    _tryProcessJob()
    {
        if (this._isProcessing) {
            return;
        }

        if (this._jobQueue.length == 0) {
            this._logger.info("[_tryProcessJob] empty");
            return;
        }

        var job = _.head(this._jobQueue);
        this._isProcessing = true;
        this._processJob(job)
            .then(result => {
                this._isProcessing = false;
                if (result.success)
                {
                    this._logger.info("[_tryProcessJob] END");
                    this._jobQueue.shift();
                    this._tryProcessJob();
                }
                else
                {
                    this._logger.warn("[_tryProcessJob] last job failed");
                    this._rescheduleProcess();
                }
                return null;
            })
            .catch(reason => {
                this._logger.error("[_tryProcessJob] ", reason);
                this._isProcessing = false;
                this._rescheduleProcess();
            })

        return null;
    }

    _rescheduleProcess()
    {
        this._logger.info("[_rescheduleProcess]");
        if (this._isScheduled) {
            return;
        }
        this._isScheduled = true;

        setTimeout(() => {
            this._isScheduled = false;
            this._tryProcessJob();
        }, this._rescheduleTimeoutMs);
    }

}