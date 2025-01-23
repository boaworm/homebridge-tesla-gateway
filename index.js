"use strict";

let Service, Characteristic, api;

const _http_base = require("homebridge-http-base");
const http = _http_base.http;
const configParser = _http_base.configParser;
const PullTimer = _http_base.PullTimer;
const notifications = _http_base.notifications;
const MQTTClient = _http_base.MQTTClient;
const Cache = _http_base.Cache;
const utils = _http_base.utils;
const request = require('request')


const packageJSON = require("./package.json");

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    api = homebridge;

    homebridge.registerAccessory("homebridge-tesla-gateway", "HTTP-TESLA-GATEWAY", HTTP_TESLA_GATEWAY);
};

function HTTP_TESLA_GATEWAY(log, config) {
    this.log = log;
    this.name = config.name;
    this.debug = config.debug || true;

	this.BatteryLevel = null;
	this.ChargingState = null;
	this.authToken = "you-have-to-initialize-token";

	this.pollingInterval = 150000; // Default, 2 and a half minutes...
	
	this.log.info("password = ", config.gatewayPassword);
	if(config.gatewayPassword){
		this.gatewayPassword = config.gatewayPassword;
	}else{
		this.log.warn("gatewayPassword not set, will not be able to authenticate");
		this.log.warn("Aborting...");
		return;
	}

    if (config.getUrl) {
        try {
            this.getUrl = configParser.parseUrlProperty(config.getUrl);
        } catch (error) {
            this.log.warn("Error occurred while parsing 'getUrl': " + error.message);
            this.log.warn("Aborting...");
            return;
        }
    }
    else {
        this.log.warn("Property 'getUrl' is required!");
        this.log.warn("Aborting...");
        return;
    }

    this.statusCache = new Cache(config.statusCache, 0);
    this.statusPattern = /(\d,[0-9]{1,3})/;
    try {
        if (config.statusPattern)
            this.statusPattern = configParser.parsePattern(config.statusPattern);
    } catch (error) {
        this.log.warn("Property 'statusPattern' was given in an unsupported type. Using default one!");
    }
    this.patternGroupToExtract = 1;
    if (config.patternGroupToExtract) {
        if (typeof config.patternGroupToExtract === "number")
            this.patternGroupToExtract = config.patternGroupToExtract;
        else
            this.log.warn("Property 'patternGroupToExtract' must be a number! Using default value!");
    }

} // End of init function

HTTP_TESLA_GATEWAY.prototype = {

    identify: function (callback) {
        this.log("Identify requested!");
        callback();
    },

    getServices: function () {
        const informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Henrik Thorburn")
            .setCharacteristic(Characteristic.Model, "HTTP Tesla Gateway")
            .setCharacteristic(Characteristic.SerialNumber, "BOA02")
            .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

		this.BatteryService = new Service.BatteryService(this.name);
		this._getStatus(function(){});
		this._getStatusFromGateway(function(){});
		this._authenticateAsync(function(){});

		setInterval(function(){
			//this._getStatus(function() {})
			this._getStatusFromGateway(function() {})
		}.bind(this), this.pollingInterval);

        return [informationService, this.BatteryService];
    },

	_httpRequest: function (url, callback){

		request({
			url: url,
			body: null,
			method: 'GET',
			timeout: this.timeout
		},
		function(error, response, body){
			callback(error, response, body)
		})

	},

	_authenticateAsync: async function(){
		//const responsePromise = fetch(`${gatewayIp}/login/Basic`, {
		const responsePromise = fetch(this.getUrl + "/login/Basic", {
			method: 'POST',
			headers: {
				"Content-Type": "application/json",
			},  
			body: JSON.stringify({
				username: "customer",  // Tesla account username
				password: `${gatewayPassword}`,  // Tesla account password
			})  
		}); 

		return responsePromise
			.then( (responseData) => responseData.json())
			.then( (responseJson) => {
				this.authToken = responseJson.token;
				return authToken
			}); 	
	},

	_getStatusFromGateway: async function(callback){
		// Fill in stuff here
	
		const token = await _authenticateAsync();
		this.log.info("*** Token", token.substring(0,10), "...");
	},

	_getStatus: function(callback){

		const url = this.getUrl.url;
		this.log.info("Processing with URL = ", url);

		this._httpRequest(url, function(error,response, responseBody){
			if(error){

				this.log.error("Error!");
				callback(error);
			}else{
				// this.log.info("Reponse = ", response); // lots of data here
				this.log.info("ResponseBody = ", responseBody);

				this.gridStatus = responseBody.split(',')[0];
				this.batteryLevel = responseBody.split(',')[1];

				this.log.info("Grid status = ", this.gridStatus);
				this.log.info("BatteryLevel = ", this.batteryLevel);

				// Let's do some random testing
				//this.gridStatus = Math.floor(Math.random() * 2);
				//this.batteryLevel = Math.floor(Math.random() * 100);

				this.BatteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.batteryLevel);
				this.BatteryService.getCharacteristic(Characteristic.ChargingState).updateValue(this.gridStatus);

				if(this.batteryLevel <= 30)
					this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
				else
					this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);

				callback();
			}

		}.bind(this))
	},

	/*
    getSensorReading: function (callback) {
		log.info("getSensorReading -> enter");	
        http.httpRequest(this.getUrl, (error, response, body) => {
            if (this.pullTimer)
                this.pullTimer.resetTimer();

            if (error) {
                this.log("getSensorReading() failed: %s", error.message);
                callback(error);
            }
            else if (!http.isHttpSuccessCode(response.statusCode)) {
                this.log("getSensorReading() returned http error: %s", response.statusCode);
                callback(new Error("Got http error code " + response.statusCode));
            }
            else {
                let sensorValue;
                try {
                    sensorValue = utils.extractValueFromPattern(this.statusPattern, body, this.patternGroupToExtract);
                } catch (error) {
                    this.log("getSensorReading() error occurred while extracting status from body: " + error.message);
                    callback(new Error("pattern error"));
                    return;
                }

                if (this.debug)
                    this.log("Status is currently at %s", sensorValue);

				this.log.info("Retrieved [", sensorValue, "] from proxy service")
                callback(null, sensorValue);
            }
        });
    },

	*/
};
