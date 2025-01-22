# homebridge-tesla-gateway Plugin

This [Homebridge](https://github.com/nfarina/homebridge) plugin can be used to display various Tesla Gateway data points, as long as it is exposed as a numeric REST endpoint, api into HomeKit. It treats the Gateway as a Battery.
BatteryLevel = Total charge in connected Powerwall
ChargingState = Is it pulling from the grid or not (1=Grid online. 0=Grid OFFLINE)

This plugin does not actually connect to the Tesla Gateway. It simply asks a tiny proxy server, which returns the status as a simple string.

1,100 would represent grid online, 100% charge

0,30 would represent grid offline, 30% charge

Future versons of this plugin may very well login directly to the gateway, but for now i am using the tesla_powerwall python lib along with Flask to run a small service.

Please note that this is heavily inspired by two projects:

dhop90's [esp8266](https://github.com/dhop90/homebridge-http-esp8266-battery) battery stuff, and 

Supereg's [homebridge-http-temperature-sensor](https://github.com/Supereg/homebridge-http-temperature-sensor)

Wwith some modifications
1) Generalizing it - making it specific to Tesla Gateway 
2) Future improvements...

## Installation

First of all you need to have [Homebridge](https://github.com/nfarina/homebridge) installed. Refer to the repo for 
instructions.  
Then run the following command to install `homebridge-tesla-gateway`

```
sudo npm install -g homebridge-tesla-gateway
```

## Updating the sensor reading in HomeKit

Two Characteristincs are used:
* ChargingState - Used as a placeholder for if the GRID is online
* BatteryLevel - Displays the powerwall(s) charge level.

### The 'pull' way:

Currently hardcoded to pull every 150 seconds

## Configuration

The configuration can contain the following properties:

##### Basic configuration options:

* `accessory` \<string\> **required**: Defines the plugin used and must be set to **"HTTP-TESLA-GATEWAY"** for this plugin.
* `name` \<string\> **required**: Defines the name which is later displayed in HomeKit
* `getUrl` \<string |  [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using 
    and urlObject) to query the current status (in numerics) from the sensor. By default it expects the http server 
    to return the sensor status as a float.

##### Advanced configuration options:

- `pullInterval` \<integer\> **optional**: The property expects an interval in **milliseconds** in which the plugin 
    pulls updates from your http device. For more information read [pulling updates](#the-pull-way).

Below is one example configuration. 
```json
{
    "accessories": [
        {
          "accessory": "HTTP_TESLA_GATEWAY",
          "name": "My Gateway",
          
          "getUrl": "http://localhost/api/pw_status"
        }   
    ]
}
```

#### UrlObject

A urlObject can have the following properties:
* `url` \<string\> **required**: Defines the url pointing to your http server
* `method` \<string\> **optional** \(Default: **"GET"**\): Defines the http method used to make the http request
* `body` \<any\> **optional**: Defines the body sent with the http request. If value is not a string it will be
converted to a JSON string automatically.
* `strictSSL` \<boolean\> **optional** \(Default: **false**\): If enabled the SSL certificate used must be valid and 
the whole certificate chain must be trusted. The default is false because most people will work with self signed 
certificates in their homes and their devices are already authorized since being in their networks.
* `auth` \<object\> **optional**: If your http server requires authentication you can specify your credential in this 
object. When defined the object can contain the following properties:
    * `username` \<string\> **required**
    * `password` \<string\> **required**
    * `sendImmediately` \<boolean\> **optional** \(Default: **true**\): When set to **true** the plugin will send the 
            credentials immediately to the http server. This is best practice for basic authentication.  
            When set to **false** the plugin will send the proper authentication header after receiving an 401 error code 
            (unauthenticated). The response must include a proper `WWW-Authenticate` header.  
            Digest authentication requires this property to be set to **false**!
* `headers` \<object\> **optional**: Using this object you can define any http headers which are sent with the http 
request. The object must contain only string key value pairs.  
* `requestTimeout` \<number\> **optional** \(Default: **20000**\): Time in milliseconds specifying timeout (Time to wait
    for http response and also setting socket timeout).
  
Below is an example of an urlObject containing the basic properties:
```json
{
  "url": "http://example.com:8080",
  "method": "GET",
  "body": "exampleBody",
  
  "strictSSL": false,
  
  "auth": {
    "username": "yourUsername",
    "password": "yourPassword"
  },
  
  "headers": {
    "Content-Type": "text/html"
  }
}
```

