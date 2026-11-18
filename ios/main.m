/*
 * The iOS shell for Vela: a tiny UIKit app that runs a program written in
 * Vela. The program itself was compiled by velac to C and then to arm64 by
 * clang; this file only supplies the window, the text view and the output
 * hook the runtime writes into.
 */

#import <UIKit/UIKit.h>

#import <dispatch/dispatch.h>

#include "vela_runtime.h"

vela_value vela_main(void);

static UITextView *gOutput = nil;
static NSMutableString *gLog = nil;

static void vela_ios_write(const char *text) {
  if (text == NULL) return;
  NSString *chunk = [NSString stringWithUTF8String:text];
  if (chunk == nil) return;

  if ([NSThread isMainThread]) {
    if (gLog == nil) gLog = [NSMutableString new];
    [gLog appendString:chunk];
    gOutput.text = gLog;
    if (gLog.length > 0) {
      [gOutput scrollRangeToVisible:NSMakeRange(gLog.length - 1, 1)];
    }
  } else {
    NSString *copy = [chunk copy];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (gLog == nil) gLog = [NSMutableString new];
      [gLog appendString:copy];
      gOutput.text = gLog;
    });
  }
}

@interface VelaViewController : UIViewController
@end

@implementation VelaViewController

- (void)viewDidLoad {
  [super viewDidLoad];

  self.view.backgroundColor = [UIColor colorWithRed:0.05 green:0.06 blue:0.10 alpha:1.0];

  UILabel *title = [[UILabel alloc] init];
  title.text = @"Vela";
  title.font = [UIFont systemFontOfSize:34.0 weight:UIFontWeightBold];
  title.textColor = [UIColor whiteColor];
  title.translatesAutoresizingMaskIntoConstraints = NO;

  UILabel *subtitle = [[UILabel alloc] init];
  subtitle.text = @"one language, compiled to C";
  subtitle.font = [UIFont systemFontOfSize:15.0 weight:UIFontWeightRegular];
  subtitle.textColor = [UIColor colorWithWhite:0.7 alpha:1.0];
  subtitle.translatesAutoresizingMaskIntoConstraints = NO;

  gOutput = [[UITextView alloc] init];
  gOutput.translatesAutoresizingMaskIntoConstraints = NO;
  gOutput.backgroundColor = [UIColor colorWithRed:0.10 green:0.12 blue:0.18 alpha:1.0];
  gOutput.textColor = [UIColor colorWithRed:0.72 green:0.95 blue:0.80 alpha:1.0];
  {
    UIFont *mono = [UIFont fontWithName:@"Menlo" size:13.0];
    gOutput.font = (mono != nil) ? mono : [UIFont systemFontOfSize:13.0];
  }
  gOutput.editable = NO;
  gOutput.text = @"tap Run";
  gOutput.textContainerInset = UIEdgeInsetsMake(12.0, 12.0, 12.0, 12.0);
  gOutput.layer.cornerRadius = 12.0;
  gOutput.clipsToBounds = YES;

  UIButton *run = [UIButton buttonWithType:UIButtonTypeSystem];
  [run setTitle:@"Run the Vela program" forState:UIControlStateNormal];
  run.titleLabel.font = [UIFont systemFontOfSize:17.0 weight:UIFontWeightSemibold];
  [run setTitleColor:[UIColor whiteColor] forState:UIControlStateNormal];
  run.backgroundColor = [UIColor colorWithRed:0.28 green:0.50 blue:1.0 alpha:1.0];
  run.layer.cornerRadius = 12.0;
  run.translatesAutoresizingMaskIntoConstraints = NO;
  [run addTarget:self
                action:@selector(runProgram)
      forControlEvents:UIControlEventTouchUpInside];

  [self.view addSubview:title];
  [self.view addSubview:subtitle];
  [self.view addSubview:run];
  [self.view addSubview:gOutput];

  UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
  [NSLayoutConstraint activateConstraints:@[
    [title.topAnchor constraintEqualToAnchor:safe.topAnchor constant:20.0],
    [title.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:20.0],
    [title.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-20.0],
    [subtitle.topAnchor constraintEqualToAnchor:title.bottomAnchor constant:2.0],
    [subtitle.leadingAnchor constraintEqualToAnchor:title.leadingAnchor],
    [subtitle.trailingAnchor constraintEqualToAnchor:title.trailingAnchor],
    [run.topAnchor constraintEqualToAnchor:subtitle.bottomAnchor constant:18.0],
    [run.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:20.0],
    [run.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-20.0],
    [run.heightAnchor constraintEqualToConstant:46.0],
    [gOutput.topAnchor constraintEqualToAnchor:run.bottomAnchor constant:16.0],
    [gOutput.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:20.0],
    [gOutput.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-20.0],
    [gOutput.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor constant:-20.0],
  ]];
}

- (void)runProgram {
  if (gLog == nil) {
    gLog = [NSMutableString new];
  } else {
    [gLog setString:@""];
  }
  gOutput.text = @"";
  vela_main();
  if (gLog.length == 0) {
    gOutput.text = @"(the program printed nothing)";
  }
}

@end

@interface VelaAppDelegate : UIResponder <UIApplicationDelegate>
@property(nonatomic, strong) UIWindow *window;
@end

@implementation VelaAppDelegate

- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
  (void)application;
  (void)launchOptions;
  self.window = [[UIWindow alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
  self.window.rootViewController = [[VelaViewController alloc] init];
  [self.window makeKeyAndVisible];
  return YES;
}

@end

int main(int argc, char *argv[]) {
  @autoreleasepool {
    vela_write_hook = vela_ios_write;
    return UIApplicationMain(argc, argv, nil, NSStringFromClass([VelaAppDelegate class]));
  }
}
