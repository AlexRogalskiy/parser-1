const yaml = require('js-yaml');
const _ = require("the-lodash");

module.exports = {
    targets: [{
        api: "apps",
        kind: "Deployment"
    }, {
        api: "apps",
        kind: "DaemonSet"
    }, {
        api: "apps",
        kind: "StatefulSet"
    }, {
        api: "batch",
        kind: "Job"
    }],

    order: 30,

    needAppScope: true,
    canCreateAppIfMissing: true,
    appNameCb: (item) => {
        return item.config.metadata.name; 
    },

    handler: ({logger, scope, item, app, appScope, namespaceScope}) =>
    {
        var labelsMap = _.get(item.config, 'spec.template.metadata.labels');
        if (labelsMap) {
            namespaceScope.appLabels.push({
                labels: labelsMap,
                name: item.config.metadata.name,
                appItem: app
            });
        }

        var launcher = app.fetchByNaming("launcher", item.config.kind);
        scope.setK8sConfig(launcher, item.config);
        namespaceScope.registerAppOwner(launcher);

        appScope.properties['Launcher'] = item.config.kind;

        if (item.config.kind == "Deployment" || 
            item.config.kind == "StatefulSet")
        {
            appScope.properties['Replicas'] = _.get(item.config, 'spec.replicas');
        }

        var volumesProperties = {

        }
        var volumesConfig = _.get(item.config, 'spec.template.spec.volumes');
        if (!volumesConfig) {
            volumesConfig = [];
        }
        volumesProperties['Count'] = volumesConfig.length;
        appScope.properties['Volumes'] = volumesConfig.length;

        // Normal Containers 
        {
            var containersConfig = _.get(item.config, 'spec.template.spec.containers');
            if (!containersConfig) {
                containersConfig = [];
            }
            appScope.properties['Container Count'] = containersConfig.length;
            if (_.isArray(containersConfig)) {
                for(var containerConfig of containersConfig)
                {
                    processContainer(containerConfig, "cont");
                }
            }
        }

        // Init Containers 
        {
            var containersConfig = _.get(item.config, 'spec.template.spec.initContainers');
            if (!containersConfig) {
                containersConfig = [];
            }
            appScope.properties['Init Container Count'] = containersConfig.length;
            if (_.isArray(containersConfig)) {
                for(var containerConfig of containersConfig)
                {
                    processContainer(containerConfig, "initcont");
                }
            }
        }

        if (_.isArray(volumesConfig) && (volumesConfig.length > 0)) {
            var volumes = app.fetchByNaming("vol", "Volumes");

            volumes.addProperties({
                kind: "key-value",
                id: "properties",
                title: "Properties",
                order: 5,
                config: volumesProperties
            });  

            for(var volumeConfig of volumesConfig) {
                processVolumeConfig(
                    volumes, 
                    volumeConfig,
                    false);
            }
        }

        app.addProperties({
            kind: "key-value",
            id: "properties",
            title: "Properties",
            order: 5,
            config: appScope.properties
        });  

        /*** HELPERS ***/

        function processContainer(containerConfig, kind)
        {
            var container = app.fetchByNaming(kind, containerConfig.name);
            scope.setK8sConfig(container, containerConfig);

            if (containerConfig.image) {
                var image = containerConfig.image;
                var imageTag;
                var i = image.indexOf(':');
                var repository = 'docker';
                if (i != -1) {
                    imageTag = image.substring(i + 1);
                    image = image.substring(0, i);
                } else {
                    imageTag = 'latest';
                }

                var imageName = image;
                i = image.lastIndexOf('/');
                if (i != -1) {
                    repository = image.substring(0, i);
                    imageName = image.substring(i + 1);
                }

                var imageItem = container.fetchByNaming("image", image);
                imageItem.addProperties({
                    kind: "key-value",
                    id: "props",
                    title: "Properties",
                    order: 10,
                    config: {
                        name: imageName,
                        tag: imageTag,
                        fullName: containerConfig.image,
                        repository: repository
                    }
                });  

            }

            var envVars = {
            }

            if (containerConfig.env) {
                for(var envObj of containerConfig.env) {
                    var value = null;
                    if (envObj.value) {
                        value = envObj.value;
                    } else if (envObj.valueFrom) {
                        value = "<pre>" + yaml.safeDump(envObj.valueFrom) + "</pre>";
                    }
                    envVars[envObj.name] = value;
                }
            }

            if (containerConfig.envFrom) {
                for(var envFromObj of containerConfig.envFrom) {
                    if (envFromObj.configMapRef) {
                        var configMapScope = findAndProcessConfigMap(container, envFromObj.configMapRef.name, true);
                        if (configMapScope) {
                            if (configMapScope.config.data) {
                                for(var dataKey of _.keys(configMapScope.config.data)) {
                                    envVars[dataKey] = configMapScope.config.data[dataKey];
                                }
                            } else {
                                container.addAlert("EmptyConfig", "warn", null, 'ConfigMap has no data: ' + envFromObj.configMapRef.name);
                            }
                        }
                    }
                }
            }


            if (_.keys(envVars).length > 0) {
                container.addProperties({
                    kind: "key-value",
                    id: "env",
                    title: "Environment Variables",
                    order: 10,
                    config: envVars
                });    
            }

            if (_.isArray(containerConfig.volumeMounts)) {
                var volumesMap = _.makeDict(volumesConfig, x => x.name);
                for(var volumeRefConfig of containerConfig.volumeMounts) {
                    var volumeConfig = volumesMap[volumeRefConfig.name];
                    if (volumeConfig) {
                        var volumeItem = processVolumeConfig(
                            container, 
                            volumeConfig,
                            true);

                        volumeItem.addProperties({
                            kind: "yaml",
                            id: "env",
                            title: "Mount Config",
                            order: 5,
                            config: volumeRefConfig
                        });  
                    }
                }
            }

            if (_.isArray(containerConfig.ports)) {
                for(var portConfig of containerConfig.ports) {
                    var portName = portConfig.protocol + "-" + portConfig.containerPort;
                    if (portConfig.name) {
                        portName = portConfig.name + " (" + portName + ")";
                    }
                    var portItem = container.fetchByNaming("port", portName);
                    scope.setK8sConfig(portItem, portConfig);

                    var portConfigScope = {
                        name: portConfig.name,
                        containerName: containerConfig.name,
                        portItem: portItem,
                        containerItem: container
                    };

                    appScope.ports[portConfig.name] = portConfigScope;
                    appScope.ports[portConfig.containerPort] = portConfigScope;
                }
            }

        }

        function processVolumeConfig(parent, volumeConfig, markUsedBy)
        {
            var volume = parent.fetchByNaming("vol", volumeConfig.name);
            scope.setK8sConfig(volume, volumeConfig);
        
            if (volumeConfig.configMap) {
                findAndProcessConfigMap(volume, volumeConfig.configMap.name, markUsedBy, volumeConfig.configMap.optional)
            }

            if (volumeConfig.secret) {
                findAndProcessSecret(volume, volumeConfig.secret.secretName, markUsedBy)
            }

            return volume;
        }
        
        function findAndProcessConfigMap(parent, name, markUsedBy, isOptional)
        {
            var configMapScope = namespaceScope.items.getItem('ConfigMap', name);
            if (configMapScope)
            {
                var configmap = parent.fetchByNaming("configmap", name);
                scope.setK8sConfig(configmap, configMapScope.config);
                if (markUsedBy) {
                    configMapScope.markUsedBy(configmap.dn);
                }
            }
            else
            {
                if (!isOptional) {
                    parent.addAlert("MissingConfig", "error", null, 'Could not find ConfigMap ' + name);
                }
            }
            return configMapScope;
        }

        function findAndProcessSecret(parent, name, markUsedBy)
        {
            var secret = parent.fetchByNaming("secret", name);
            if (markUsedBy) {
                var secretScope = namespaceScope.getSecret(name);
                secretScope.usedBy[secret.dn] = true;
            }
        }
    }
}


