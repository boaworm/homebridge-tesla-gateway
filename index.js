"use strict";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

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
	this.verboseLogging = false;

	this.BatteryLevel = null;
	this.ChargingState = null;
	this.authToken = null;
	this.startupTime = new Date();

	this.currentBatteryLevel = 100;
	this.currentGridStatus = 1;

	if(config.enableVerboseLogging){
		this.log.info("Setting trace log to:", config.enableVerboseLogging);
		if(config.enableVerboseLogging == "true" || config.enableVerboseLogging == 1){
			this.verboseLogging = true;
		}else{
			this.verboseLogging = false;
		}
	}

	this.log.info("Verbose logging is set to:", this.verboseLogging);

	this.pollingInterval = 150000; // Default, 2 and a half minutes...
	//
	if(config.pullInterval){
		this.log.info("Read \"pullInterval\" =",config.pullInterval," from config, applying");
		this.pollingInterval = config.pullInterval;
	}else{
		this.log.info("No \"pullInterval\" set - defaulting to ", this.pollingInterval);
	}
	
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
    } else {
        this.log.warn("Property 'getUrl' is required!");
        this.log.warn("Aborting...");
        return;
    }

} // End of init function

HTTP_TESLA_GATEWAY.prototype = {

    identify: function (callback) {
        this.log("Identify requested!");
        callback();
    },

	trace: function(message){
		if(this.verboseLogging){
			this.log.info(message);	
		}
	},

	isStartingUp: function(){
		const timeNow = new Date();
		const elapsedTimeMillis = (timeNow - this.startupTime);
		if(elapsedTimeMillis > (30*1000)){
			return false;
		}else{
			return true;
		}
	},

	truncateToken: function(token){
		if(token == null){
			return "NO-TOKEN";
		}else if(token instanceof Function){
			// This seems to happen because functions are called as plugin is initialized
			// Can safely be ignored/treated as a case of no-token-yet
			return "NO-TOKEN";
		}else{
			let truncatedToken = token.substring(0,5) + "...";
			return truncatedToken;
		}
	},

	_getAuthenticateAsync: async function(){

		if(this.authToken != null){
			// Let's see how old it is
			let endTime = new Date();
			let timeDiff = endTime - this.tokenIssuedAtTime;
			timeDiff /= 1000;
			if( timeDiff > (30 * 60) ){
				this.trace("Token is older than 30 minutes. Getting a new one");
			}else{
				this.trace("Recent auth token cached (starting with [" + this.truncateToken(this.authToken) + "] Reusing it");
				return this.authToken;
			}
		}

		const myUrl = this.getUrl.url + "/login/Basic";
		this.trace("Attempting to get a new token from endpoint: " + myUrl);
		try{
			const responsePromise = fetch(myUrl, {
				method: 'POST',
				headers: {
					"Content-Type": "application/json",
				},  
				body: JSON.stringify({
					username: "customer",  // Tesla account username - is always "customer"
					password: this.gatewayPassword,  // Tesla account password
				})  
			}); 

			return responsePromise
				.then( (responseData) => responseData.json())
				.then( (responseJson) => {

					// See if we can grab a token:
					if(responseJson != null && responseJson.token){
						this.authToken = responseJson.token;
						this.trace("Successfully retrieved a new token: " + this.truncateToken(this.authToken));
						return this.authToken;
					}else{
						if(!this.isStartingUp()){
							this.log.error("Failed to get new token. Response is:", responseJson);

						}	
					}
				}); 	
		}catch(error){
			this.log.error("Exception when getting a token:", error);
		}
	},


    getServices: function () {
        const informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Henrik Thorburn")
            .setCharacteristic(Characteristic.Model, "HTTP Tesla Gateway")
            .setCharacteristic(Characteristic.SerialNumber, "BOA02")
            .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

		this.BatteryService = new Service.BatteryService(this.name);
		this._getAuthenticateAsync(async function(){});
		this._getStatusFromGateway(async function(){});
		this._getDataFromEndpointAsync(async function(serviceName){});
		this._getGridStatus(async function(){});
		this._getBatteryChargeLevel(async function(){});
		this.trace(function(message){});
		this.truncateToken(function(token){});
		this.isStartingUp(function(){});

		setInterval(function(){
			this._getStatusFromGateway(async function() {})
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

	_getGridStatus: async function(){
		const body = await this._getDataFromEndpointAsync("system_status/grid_status");
		if(body==null){
			// Only log this error if we're not in startup mode.
			// This is because of plugins and threading - we may call too early
			if(!this.isStartingUp()){
				this.log.error("Got null when trying to get grid status");
			}
			if(this.verboseLogging){
				this.log.warn("Unable to get Grid Status, returning cached value: [", this.currentGridStatus,"]");
			}
			return this.currentGridStatus;
		}else{
			const gridStatusInt = (body.grid_status=="SystemGridConnected") ? 1 : 0;
			return gridStatusInt;
		}
	},

	_getBatteryChargeLevel: async function(){
		const body = await this._getDataFromEndpointAsync("/system_status/soe");
		if(body==null){
			// Only log this error if we're not in startup mode.
			// This is because of plugins and threading - we may call too early
			if(!this.isStartingUp()){
				this.log.error("Got null when trying to get battery level");
			}
			if(this.verboseLogging){
				this.log.warn("Failed to refresh batteryLevel, returning cached value [", this.currentBatteryLevel,"]");
			}
			return this.currentBatteryLevel;
		}else{
			return body.percentage;
		}
	
	},
/*
	_getDataFromEndpointAsync: async function(serviceName){
		if(this.authToken == null){
			// Only log this error if we're not in startup mode.
			// This is because of plugins and threading - we may call too early
			if(!this.isStartingUp()){
				this.log.error("No authToken - ignoring request to pull from ",serviceName);
			}
			return null;
		}

		this.trace("Getting data from endpoint " + serviceName + " using authToken [" + this.truncateToken(this.authToken) + "]");
		let myUrl = this.getUrl.url + "/" + serviceName;
		const responsePromise = fetch(myUrl, {
			method: "GET",
			headers: {
				"Authorization": `Bearer ${this.authToken}`, // Use the auth token from login
			},
		});

		return responsePromise
			.then( (responseData) => responseData.json())
			.then( (responseJson) => {return responseJson});
	},
*/
	// experiment begin

	_getDataFromEndpointAsync: async function(serviceName){
		if(this.authToken == null){
			// Only log this error if we're not in startup mode.
			// This is because of plugins and threading - we may call too early
			if(!this.isStartingUp()){
				this.log.error("No authToken - ignoring request to pull from ",serviceName);
			}
			return null;
		}

		this.trace("Getting data from endpoint " + serviceName + " using authToken [" + this.truncateToken(this.authToken) + "]");

		// Randomly damaging token, for resiliency testing
		if( Math.floor(Math.random() * 5) == 0){
			this.authToken = null;
			this.log.info("Destroying token");
		}


		let myUrl = this.getUrl.url + "/" + serviceName;
		const responsePromise = fetch(myUrl, {
			method: "GET",
			headers: {
				"Authorization": `Bearer ${this.authToken}`, // Use the auth token from login
			},
		});

		return responsePromise
			.then( (responseData) => {
				// this.log.info("responseData=", responseData);
				if(responseData != null){
					if(responseData.status == 200){
						return responseData.json();
					}else if(responseData.status == 401 || responseData.status == 403){
						if(!this.isStartingUp()){
							this.log.error("Unauthorized/", responseData.status);
							if(this.verboseLogging)
								this.log.error(responseData);
							this.authToken = null;// clearing token, will get fresh one next time
						}
					}else if(responseData.status == 423){
						// Resource locked - too many API calls
						if(!this.isStartingUp()){
							this.log.error("Too may API calls/423");
							this.log.error(responseData);
						}
					}else{
						if(!this.isStartingUp()){
							this.log.error("Unhandled http response code:", responseData.status);
							this.log.error(responseData);
						}		
					}
				}
				return null;
				// return responseData.json();
			})
			.then( (responseJson) => {return responseJson});
	},





	// experiment end


	// The "main" function
	_getStatusFromGateway: async function(callback){
		try{
			const token = await this._getAuthenticateAsync();
			if(token != null){

				const gridStatus = await this._getGridStatus();
				this.currentGridStatus = gridStatus;
				this.trace("*** Grid Status: " + gridStatus);

				const batteryLevel = Math.floor(await this._getBatteryChargeLevel());
				this.currentBatteryLevel = batteryLevel;
				this.trace("*** Battery Level: " + batteryLevel);

				// Refresh Characteristics 
				this.BatteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(batteryLevel);
				this.BatteryService.getCharacteristic(Characteristic.ChargingState).updateValue(gridStatus);

				if(batteryLevel <= 30){
					this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
				} else {
					this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
				}
				// End of refresh block

				callback();


			}else{
				if(!this.isStartingUp()){
					this.log.error("No token - skipping fetching of status");
				}
			}

		}catch(error){
			this.log.error("Exception:", error);
		}
	},

};
