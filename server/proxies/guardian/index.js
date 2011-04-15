var proxies = require('../../proxies');
var http = require('http');
var async = require('async');
var exceptions = require('../../exceptions');
var model = require('../../model');

var GuardianProxy = function(configuration) {
  var domain = "content.guardianapis.com";
  var api_key = "ywyfby4r7zsfy2rc8eesk6q3";
  this.configuration = configuration;

  var fetchResults = function(res, callback) {
    var data = "";
    res.setEncoding('utf-8');
    res.on('data', function(chunk) {
      data += chunk;
    });

    res.on('end', function() {
      callback(JSON.parse(data));
    });
  };

  var toQueryString = function(opts) {
    var qs = []; 
   
    for(var q in opts) {
      qs.push(encodeURIComponent(q) + "=" + opts[q]);
    }
    return qs.join("&");
  };
 
  this._fetchCategories = function(categories, callback) {
    if(!!callback == false) throw new exceptions.NoCallbackException();
    
    var query = {
      "q": categories.join("+"),
      "format": "json",
      "show-media": "all",
      "page-size": "8",
      "api-key": api_key
    };

    var options = {
      host: domain, 
      port: 80,
      path: '/sections?' + toQueryString(query) 
    };
    http.get(options, function(res) {fetchResults(res, callback);} ); 
  };

  this._fetchCategory = function(id, fields, callback) {
    if(!!callback == false) throw new exceptions.NoCallbackException();
    
    var query = {
      "section": id,
      "show-fields": fields.join(","),
      "format": "json",
      "page-size": "8",
      "show-media": "all",
      "use-date": "last-modified",
      "api-key": api_key
    };

    var options = {
      host: domain,
      port: 80,
      path: '/search?' + toQueryString(query)
    };

    http.get(options, function(res) { fetchResults(res, callback);});
  };

  this._fetchArticle = function(id, category, callback) {
    if(!!callback == false) throw new exceptions.NoCallbackException();
    
    var query = {
      "format": "json",
      "show-fields": "all",
      "show-media": "all",
      "api-key": api_key
    };
   
    var options = {
      host: domain,
      port: 80,
      path: "/" + decodeURIComponent(id) + "?" + toQueryString(query)
    }
     
    http.get(options, function(res) {fetchResults(res, callback);});  
  };
};

GuardianProxy.prototype = new proxies.Proxy();
GuardianProxy.prototype.constructor = proxies.GuardianProxy;

GuardianProxy.prototype.fetchCategories = function(callback) {
  if(!!callback == false) throw new exceptions.NoCallbackException();
  var self = this;
  var data = this._fetchCategories(this.configuration.categories, function(data) {
    if(!!data.response == false || data.response.status != "ok") return; 
    var results = data.response.results;
    var categories = [];    
    for(var r in results) {
      var result = results[r];
      var new_category = new model.CategoryData(result.id, result.webTitle);
      var output_callback = (function(cat) {
        return function(inner_callback) {
          self._fetchCategory(cat.id, ["byline", "standfirst", "thumbnail"], function(category_data) {
            if(!!category_data.response == false) return;
            var cat_results = category_data.response.results;
            
            for(var cat_r in cat_results) {
              var cat_res = cat_results[cat_r];
              if(!!cat_res.fields == false) continue;
              if(!!cat_res.fields.thumbnail == false) continue;
              var item = new model.CategoryItem(cat_res.id, cat_res.webTitle, cat_res.fields.standfirst, cat);
              item.thumbnail = cat_res.fields.thumbnail;
              item.pubDate = cat_res.webPublicationDate;
              item.author = cat_res.fields.byline;
              item.url = cat_res.webUrl;
              item.largeImage = self.findLargestImage(cat_res.mediaAssets).url;
              cat.addItem(item);
            }
            inner_callback(null, cat);
          });
        };
      })(new_category);
      categories.push(output_callback); 
    }

    // execute the category requests in parallel.
    async.parallel(categories, function(err, results){ callback(results); });
  });
};

GuardianProxy.prototype.fetchCategory = function(id, callback) {
  if(!!callback == false) throw new exceptions.NoCallbackException();
  var self = this;
  var data = this._fetchCategories(this.configuration.categories, function(data) {
    if(!!data.response == false || data.response.status != "ok") return; 
    var results = data.response.results;
    var categories = [];    
    for(var r in results) {
      var result = results[r];
      var category = new model.CategoryData(result.id, result.webTitle);
      var output_callback = (function(cat) {
        return function(inner_callback) {
          self._fetchCategory(cat.id, ["all"], function(category_data) {
            if(!!category_data.response == false || category_data.response.status != "ok") return;
            if(cat.id == id) cat.state = "active";
            var cat_results = category_data.response.results;
            for(var cat_r in cat_results) {
              var cat_result = cat_results[cat_r];
              var item = new model.CategoryItem(cat_result.id, cat_result.webTitle, cat_result.fields.standfirst, cat);
              item.thumbnail = cat_result.fields.thumbnail;
              item.pubDate = cat_result.webPublicationDate;
              item.author = cat_result.fields.byline;
              item.url = cat_result.webUrl;
              item.largeImage = self.findLargestImage(cat_result.mediaAssets).url;
              cat.addItem(item); 
            }
            inner_callback(null, cat);
           });
        };
      })(category);
      categories.push(output_callback);
    }

    async.parallel(categories, function(err, presults){ callback(presults); });
  });
};

GuardianProxy.prototype.findLargestImage = function(mediaAssets) {
  var asset;
  var largest = {size: 0, x: 0, y:0, url:""};

  if(!!mediaAssets == false) return largest;

  for(var i = 0; asset = mediaAssets[i]; i++) {
    if(asset.type != "picture") continue;
    var size = parseInt(asset.fields.width,10) * parseInt(asset.fields.height,10);
    if(size > largest.size) {
      largest = {size: size, x: asset.fields.width, y: asset.fields.height, url: asset.file };
    }
  }
  return largest;
};

GuardianProxy.prototype.fetchArticle = function(id, category, callback) {
  if(!!callback == false) throw new exceptions.NoCallbackException();
  var self = this;
  this._fetchCategories(this.configuration.categories, function(data) {
    if(!!data.response == false || data.response.status != "ok") return; 
    var results = data.response.results;
    var categories = [];
    var fetching = false;
     
    for(var r in results) {
      var result = results[r];
      var newCat = new model.CategoryData(result.id, result.webTitle);

      // Get the basic article information to blend it into the results

      var outer_function = (function(cat) { return function(inner_callback) {
        if(cat.id == category) {
          self._fetchArticle(id, cat.id, function(article_data) {
            if(!!article_data.response == false || article_data.response.status != "ok") return;
            var article_result = article_data.response.content;
            var item = new model.CategoryItem(article_result.id, article_result.webTitle, article_result.fields.trailText, cat);
            if(!!article_result.fields.body)
              item.body = article_result.fields.body.replace(/\"/gim,'\\"').replace(/\n/gim,"").replace(/\r/gim,"");
            item.thumbnail = article_result.fields.thumbnail;
            item.largeImage = self.findLargestImage(article_result.mediaAssets).url;
            item.pubDate = article_result.webPublicationDate;
            item.author = article_result.fields.byline;
            item.url = article_result.webUrl;
            cat.addItem(item);
      
            inner_callback(null, cat);
          }); 
        }
        else {
          inner_callback(null, cat);
        }
      }
      })(newCat);
      categories.push(outer_function);
    }
    // If there is no matching category, it will lock.
    async.parallel(categories, function(err, presults){ callback(presults); });
  }); 
};

exports.proxy = GuardianProxy;
